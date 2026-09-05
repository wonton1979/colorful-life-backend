import { Decimal } from "@prisma/client/runtime/client";
import { randomUUID } from "node:crypto";
import { PaymentProvider, PaymentStatus, RefundProvider, RefundStatus } from "../../generated/prisma-client/enums.js";
import { prisma } from "../../prisma/runtime.js";
import { config } from "../../config/index.js";
import { reserveRefundCapacity, finalizeRefundCapacity, releaseRefundCapacity } from "./refundCapacityService.js";
import { RefundAmountExceededError, RefundOrderNotFoundError, RefundPaymentNotFoundError, RefundPaymentNotRefundableError } from "./refundErrors.js";

export class PayPalRefundProviderError extends Error {}
export class PayPalRefundValidationError extends Error {}

export type PayPalRefundResponse = { id?: string; status?: string; amount?: { value?: string; currency_code?: string } };
export type PayPalRefundClient = { refundCapture(captureId: string, requestId: string, amount: string, currency: string): Promise<PayPalRefundResponse> };
let testClient: PayPalRefundClient | undefined;
export function setPayPalRefundClientForTests(client: PayPalRefundClient): () => void { const previous = testClient; testClient = client; return () => { testClient = previous; }; }

function createClient(): PayPalRefundClient {
  if (!config.PAYPAL_CLIENT_ID || !config.PAYPAL_CLIENT_SECRET) throw new PayPalRefundProviderError("PayPal is not configured");
  let accessToken: string | undefined;
  return { async refundCapture(captureId, requestId, amount, currency) { try { if (!accessToken) { const auth = await fetch(`${config.PAYPAL_BASE_URL}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_CLIENT_SECRET}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" }); if (!auth.ok) throw new Error(); accessToken = (await auth.json() as { access_token: string }).access_token; } const response = await fetch(`${config.PAYPAL_BASE_URL}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "PayPal-Request-Id": requestId }, body: JSON.stringify({ amount: { value: amount, currency_code: currency } }) }); if (!response.ok) throw new Error(); return await response.json() as PayPalRefundResponse; } catch { throw new PayPalRefundProviderError("PayPal refund operation failed"); } } };
}

export async function createOrReusePayPalRefund(orderId: number, paymentId: number, inputAmount: Decimal | number, reason: string | undefined, performedByUserId: number, client?: PayPalRefundClient, refundId?: number) {
  const requested = inputAmount instanceof Decimal ? inputAmount : new Decimal(inputAmount);
  if (requested.lte(0) || !requested.mul(100).isInteger()) throw new PayPalRefundValidationError("Invalid refund amount");
  const prepared = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true } }); if (!order) throw new RefundOrderNotFoundError(orderId);
    const payment = await tx.payment.findUnique({ where: { id: paymentId } }); if (!payment || payment.orderId !== orderId) throw new RefundPaymentNotFoundError(paymentId, orderId);
    if (payment.status !== PaymentStatus.SUCCEEDED) throw new RefundPaymentNotRefundableError(paymentId);
    if (payment.provider !== PaymentProvider.PAYPAL || !payment.providerCaptureReference) throw new PayPalRefundValidationError("PayPal capture is unavailable");
    const key = `refund-${randomUUID()}-paypal`;
    const existing = refundId ? await tx.refund.findUnique({ where: { id: refundId } }) : null;
    if (existing) {
      if (existing.orderId !== orderId || existing.paymentId !== paymentId || existing.provider !== RefundProvider.PAYPAL) throw new PayPalRefundValidationError("Refund attempt does not belong to this payment");
      if (existing.status === RefundStatus.SUCCEEDED) return { existing, payment, key };
      if (existing.status === RefundStatus.FAILED) throw new PayPalRefundValidationError("Refund attempt has failed");
      if (!existing.refundIdempotencyKey || new Decimal(existing.amount).lte(0) || !new Decimal(existing.amount).mul(100).isInteger() || existing.currency !== payment.currency) throw new PayPalRefundValidationError("Refund attempt is invalid");
      return { existing, payment, key };
    }
    await reserveRefundCapacity(paymentId, requested, tx);
    return { existing: await tx.refund.create({ data: { orderId, paymentId, amount: requested, currency: payment.currency, status: RefundStatus.PROCESSING, provider: RefundProvider.PAYPAL, providerReference: `pending:${key}`, refundIdempotencyKey: key, reason: reason?.trim() || undefined, performedByUserId } }), payment, key };
  });
  if (prepared.existing?.status === RefundStatus.SUCCEEDED) return prepared.existing;
  if (!prepared.existing) throw new PayPalRefundValidationError("Refund attempt unavailable");
  if (prepared.existing.status !== RefundStatus.PROCESSING) throw new PayPalRefundValidationError("Refund attempt is not retryable");
  const storedAmount = new Decimal(prepared.existing.amount);
  const storedCurrency = prepared.existing.currency;
  let response: PayPalRefundResponse;
  try { response = await (client ?? testClient ?? createClient()).refundCapture(prepared.payment.providerCaptureReference!, prepared.existing.refundIdempotencyKey!, storedAmount.toFixed(2), storedCurrency); }
  catch (error) { if (error instanceof PayPalRefundProviderError) throw error; throw new PayPalRefundProviderError("PayPal refund operation failed"); }
  if (response.status === "FAILED" || response.status === "DENIED") return prisma.$transaction(async (tx) => { await releaseRefundCapacity(paymentId, storedAmount, tx); return tx.refund.update({ where: { id: prepared.existing!.id }, data: { status: RefundStatus.FAILED } }); });
  const valid = response.status === "COMPLETED" && !!response.id && response.amount?.value === storedAmount.toFixed(2) && response.amount.currency_code?.toUpperCase() === storedCurrency.toUpperCase();
  if (!valid) throw new PayPalRefundValidationError("PayPal refund response did not match the local refund");
  return prisma.$transaction(async (tx) => {
    await finalizeRefundCapacity(paymentId, storedAmount, tx);
    return tx.refund.update({ where: { id: prepared.existing.id }, data: { providerReference: response.id, status: RefundStatus.SUCCEEDED } });
  });
}
