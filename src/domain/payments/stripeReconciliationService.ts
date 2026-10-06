import { confirmOrderInTransaction } from "../orders/orderConfirmationService.js";
import { PaymentProvider, PaymentStatus, OrderStatus } from "../../generated/prisma-client/enums.js";
import { prisma } from "../../prisma/runtime.js";
import { Decimal } from "@prisma/client/runtime/client";
import { finalizeRefundCapacity, releaseRefundCapacity } from "../refunds/refundCapacityService.js";
import { RefundProvider, RefundStatus } from "../../generated/prisma-client/enums.js";

export type StripePaymentIntentEvent = {
  id: string;
  type: "payment_intent.succeeded" | "payment_intent.payment_failed" | "payment_intent.canceled";
  paymentIntentId: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
};

export async function reconcileStripePaymentEvent(event: StripePaymentIntentEvent): Promise<{ duplicate: boolean; handled: boolean }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const receipt = await tx.paymentWebhookEvent.create({ data: { provider: PaymentProvider.STRIPE, providerEventId: event.id, eventType: event.type } });
      // Correlate a verified event arriving before initiation persists the provider
      // reference using the server-authored orderId metadata and pending attempt.
      const metadataOrderId = Number(event.metadata?.orderId);
      const candidate = await tx.payment.findFirst({ where: {
        provider: PaymentProvider.STRIPE,
        OR: [
          { providerReference: event.paymentIntentId },
          ...(Number.isSafeInteger(metadataOrderId) && metadataOrderId > 0 ? [{ orderId: metadataOrderId, providerReference: `pending:order-${metadataOrderId}-stripe` }] : []),
        ],
      } });
      if (candidate) await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${candidate.orderId} FOR UPDATE`;
      const payment = candidate ? await tx.payment.findUnique({ where: { id: candidate.id }, include: { order: true } }) : null;
      if (!payment) {
        await tx.paymentWebhookEvent.update({ where: { id: receipt.id }, data: { processedAt: new Date(), processingError: "Unknown Stripe payment" } });
        return { duplicate: false, handled: false };
      }
      const expectedAmount = new Decimal(payment.amount).mul(100).toNumber();
      if (payment.providerReference !== event.paymentIntentId && !payment.providerReference.startsWith("pending:")) {
        await tx.paymentWebhookEvent.update({ where: { id: receipt.id }, data: { processedAt: new Date(), processingError: "Stripe payment reference mismatch" } });
        return { duplicate: false, handled: false };
      }
      if (event.metadata?.orderId && event.metadata.orderId !== String(payment.orderId)) {
        await tx.paymentWebhookEvent.update({ where: { id: receipt.id }, data: { processedAt: new Date(), processingError: "Stripe order correlation mismatch" } });
        return { duplicate: false, handled: false };
      }
      if (event.type === "payment_intent.succeeded" && (event.amount !== expectedAmount || event.currency.toLowerCase() !== "gbp")) {
        await tx.paymentWebhookEvent.update({ where: { id: receipt.id }, data: { processedAt: new Date(), processingError: "Stripe payment amount or currency mismatch" } });
        return { duplicate: false, handled: false };
      }
      if (event.type === "payment_intent.succeeded" && payment.status !== PaymentStatus.SUCCEEDED) {
        await tx.payment.update({ where: { id: payment.id }, data: { providerReference: event.paymentIntentId, status: PaymentStatus.SUCCEEDED, paidAt: payment.paidAt ?? new Date() } });
      } else if (event.type === "payment_intent.payment_failed" && payment.status !== PaymentStatus.SUCCEEDED) {
        await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED } });
      } else if (event.type === "payment_intent.canceled" && payment.status !== PaymentStatus.SUCCEEDED) {
        await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.CANCELED } });
      }
      // Receipt, payment success, inventory conversion and order status commit
      // together. A conversion failure rolls everything back so Stripe can retry.
      if (event.type === "payment_intent.succeeded" && payment.order.status === OrderStatus.PENDING) {
        await confirmOrderInTransaction(tx, payment.order.userId, payment.orderId);
      }
      const reconciliation = event.type === "payment_intent.succeeded" &&
        (payment.order.status === OrderStatus.EXPIRED || payment.order.status === OrderStatus.CANCELLED || payment.order.status === OrderStatus.RETURNED)
        ? `Captured payment for ${payment.order.status.toLowerCase()} order requires refund/reconciliation` : null;
      await tx.paymentWebhookEvent.update({ where: { id: receipt.id }, data: { processedAt: new Date(), processingError: reconciliation } });
      return { duplicate: false, handled: true };
    });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      const receipt = await prisma.paymentWebhookEvent.findFirst({ where: { provider: PaymentProvider.STRIPE, providerEventId: event.id } });
      if (receipt) return { duplicate: true, handled: true };
    }
    throw error;
  }
}

export type StripeRefundEvent = { id: string; type: "refund.created" | "refund.updated" | "refund.failed"; refundId: string; paymentIntentId?: string | null; amount: number; currency: string; status: string; metadata?: Record<string, string> };

function paymentIntentId(value: string | { id: string } | null | undefined) { return typeof value === "string" ? value : value?.id; }

export async function reconcileStripeRefundEvent(event: StripeRefundEvent): Promise<{ duplicate: boolean; handled: boolean }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const receipt = await tx.paymentWebhookEvent.create({ data: { provider: PaymentProvider.STRIPE, providerEventId: event.id, eventType: event.type } });
      let refund = await tx.refund.findFirst({ where: { provider: RefundProvider.STRIPE, providerReference: event.refundId } });
      const localId = Number(event.metadata?.local_refund_id);
      if (!refund && Number.isInteger(localId) && localId > 0) refund = await tx.refund.findUnique({ where: { id: localId } });
      const payment = refund ? await tx.payment.findUnique({ where: { id: refund.paymentId } }) : null;
      const metadataMatches = !event.metadata?.local_refund_id || (Number.isInteger(localId) && localId === refund?.id);
      const providerReferenceMatches = !!refund && (refund.providerReference === event.refundId || refund.providerReference.startsWith("pending:"));
      const valid = !!refund && !!payment && metadataMatches && providerReferenceMatches && refund.provider === RefundProvider.STRIPE && payment.provider === PaymentProvider.STRIPE && paymentIntentId(event.paymentIntentId) === payment.providerReference && event.amount === new Decimal(refund.amount).mul(100).toNumber() && event.currency.toLowerCase() === refund.currency.toLowerCase() && (!event.metadata?.order_id || event.metadata.order_id === String(refund.orderId));
      if (!valid) { await tx.paymentWebhookEvent.update({ where: { id: receipt.id }, data: { processedAt: new Date(), processingError: "Stripe refund correlation or financial validation failed" } }); return { duplicate: false, handled: false }; }
      if (refund!.status === RefundStatus.PROCESSING) {
        if (event.status === "succeeded") { await finalizeRefundCapacity(refund!.paymentId, refund!.amount, tx); await tx.refund.update({ where: { id: refund!.id }, data: { providerReference: event.refundId, status: RefundStatus.SUCCEEDED } }); }
        else if (event.status === "failed" || event.status === "canceled") { await releaseRefundCapacity(refund!.paymentId, refund!.amount, tx); await tx.refund.update({ where: { id: refund!.id }, data: { providerReference: event.refundId, status: RefundStatus.FAILED } }); }
        else await tx.refund.update({ where: { id: refund!.id }, data: { providerReference: event.refundId } });
      }
      await tx.paymentWebhookEvent.update({ where: { id: receipt.id }, data: { processedAt: new Date() } });
      return { duplicate: false, handled: true };
    });
  } catch (error) { if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") return { duplicate: true, handled: true }; throw error; }
}
