import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/client";
import { PaymentProvider, PaymentStatus, RefundProvider, RefundStatus } from "../../generated/prisma-client/enums.js";
import { prisma } from "../../prisma/runtime.js";
import { config } from "../../config/index.js";
import { reserveRefundCapacity, finalizeRefundCapacity, releaseRefundCapacity } from "./refundCapacityService.js";
import { RefundOrderNotFoundError, RefundPaymentNotFoundError, RefundPaymentNotRefundableError } from "./refundErrors.js";

export class StripeRefundProviderError extends Error {}
export class StripeRefundValidationError extends Error {}

export type StripeRefundResponse = Pick<Stripe.Refund, "id" | "amount" | "currency" | "status" | "payment_intent" | "metadata">;
export type StripeRefundClient = { createRefund(input: Stripe.RefundCreateParams, options: Stripe.RequestOptions): Promise<StripeRefundResponse> };
let testClient: StripeRefundClient | undefined;

export function setStripeRefundClientForTests(client: StripeRefundClient): () => void {
  const previous = testClient;
  testClient = client;
  return () => { testClient = previous; };
}

function client(): StripeRefundClient {
  if (!config.STRIPE_SECRET_KEY) throw new StripeRefundProviderError("Stripe is not configured");
  const stripe = new Stripe(config.STRIPE_SECRET_KEY);
  return { createRefund: (input, options) => stripe.refunds.create(input, options) as Promise<StripeRefundResponse> };
}

function amount(value: Decimal | number): Decimal {
  const result = value instanceof Decimal ? value : new Decimal(value);
  if (result.lte(0) || !result.mul(100).isInteger()) throw new StripeRefundValidationError("Invalid refund amount");
  return result;
}

function minorUnits(value: Decimal): number {
  const minor = value.mul(100);
  if (!minor.isInteger() || !minor.lte(Number.MAX_SAFE_INTEGER)) throw new StripeRefundValidationError("Invalid refund amount");
  return minor.toNumber();
}

export async function createOrReuseStripeRefund(orderId: number, paymentId: number, inputAmount: Decimal | number, reason: string | undefined, performedByUserId: number, injectedClient?: StripeRefundClient, refundId?: number) {
  const requested = amount(inputAmount);
  const prepared = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true } });
    if (!order) throw new RefundOrderNotFoundError(orderId);
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.orderId !== orderId) throw new RefundPaymentNotFoundError(paymentId, orderId);
    if (payment.status !== PaymentStatus.SUCCEEDED) throw new RefundPaymentNotRefundableError(paymentId);
    if (payment.provider !== PaymentProvider.STRIPE || !payment.providerReference || payment.providerReference.startsWith("pending:")) throw new StripeRefundValidationError("Stripe PaymentIntent is unavailable");
    const existing = refundId ? await tx.refund.findUnique({ where: { id: refundId } }) : null;
    if (existing) {
      if (existing.orderId !== orderId || existing.paymentId !== paymentId || existing.provider !== RefundProvider.STRIPE) throw new StripeRefundValidationError("Refund attempt does not belong to this payment");
      if (existing.status === RefundStatus.SUCCEEDED) return { existing, payment };
      if (existing.status === RefundStatus.FAILED) throw new StripeRefundValidationError("Refund attempt has failed");
      if (!existing.refundIdempotencyKey || new Decimal(existing.amount).lte(0) || !new Decimal(existing.amount).mul(100).isInteger() || existing.currency !== payment.currency) throw new StripeRefundValidationError("Refund attempt is invalid");
      return { existing, payment };
    }
    const key = `refund-${randomUUID()}-stripe`;
    await reserveRefundCapacity(paymentId, requested, tx);
    const created = await tx.refund.create({ data: { orderId, paymentId, amount: requested, currency: payment.currency, status: RefundStatus.PROCESSING, provider: RefundProvider.STRIPE, providerReference: `pending:${key}`, refundIdempotencyKey: key, reason: reason?.trim() || undefined, performedByUserId } });
    return { existing: created, payment };
  });
  if (prepared.existing.status === RefundStatus.SUCCEEDED) return prepared.existing;
  if (prepared.existing.status !== RefundStatus.PROCESSING || !prepared.existing.refundIdempotencyKey) throw new StripeRefundValidationError("Refund attempt is not retryable");
  const storedAmount = new Decimal(prepared.existing.amount);
  const storedCurrency = prepared.existing.currency;
  let response: StripeRefundResponse;
  try {
    response = await (injectedClient ?? testClient ?? client()).createRefund({ payment_intent: prepared.payment.providerReference, amount: minorUnits(storedAmount), metadata: { local_refund_id: String(prepared.existing.id), order_id: String(orderId) }, ...(reason ? { reason: reason as Stripe.RefundCreateParams.Reason } : {}) }, { idempotencyKey: prepared.existing.refundIdempotencyKey });
  } catch (error) {
    if (error instanceof StripeRefundProviderError) throw error;
    throw new StripeRefundProviderError("Stripe refund operation failed");
  }
  const identityMatches = response.payment_intent === prepared.payment.providerReference || (typeof response.payment_intent === "object" && response.payment_intent?.id === prepared.payment.providerReference);
  if (!identityMatches || response.amount !== minorUnits(storedAmount) || response.currency.toUpperCase() !== storedCurrency.toUpperCase()) throw new StripeRefundValidationError("Stripe refund response did not match the local refund");
  if (response.status === "failed" || response.status === "canceled") return prisma.$transaction(async (tx) => { await releaseRefundCapacity(paymentId, storedAmount, tx); return tx.refund.update({ where: { id: prepared.existing.id }, data: { providerReference: response.id, status: RefundStatus.FAILED } }); });
  if (response.status === "pending" || response.status === "requires_action") return prisma.refund.update({ where: { id: prepared.existing.id }, data: { providerReference: response.id } });
  if (response.status !== "succeeded" || !response.id) throw new StripeRefundValidationError("Stripe refund response status is invalid");
  return prisma.$transaction(async (tx) => { await finalizeRefundCapacity(paymentId, storedAmount, tx); return tx.refund.update({ where: { id: prepared.existing.id }, data: { providerReference: response.id, status: RefundStatus.SUCCEEDED } }); });
}
