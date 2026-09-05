import Stripe from "stripe";
import { Decimal } from "@prisma/client/runtime/client";
import { PaymentProvider, PaymentStatus, OrderStatus } from "../../generated/prisma-client/enums.js";
import { prisma } from "../../prisma/runtime.js";
import { config } from "../../config/index.js";

export class StripePaymentOrderNotFoundError extends Error {}
export class StripePaymentOwnershipError extends Error {}
export class StripePaymentExpiredError extends Error {}
export class StripePaymentAlreadyCompletedError extends Error {}
export class StripePaymentProviderError extends Error {}

export type StripePaymentClient = Pick<Stripe, "paymentIntents">;
let testClient: StripePaymentClient | undefined;

export function setStripePaymentClientForTests(client: StripePaymentClient): () => void {
  const previous = testClient;
  testClient = client;
  return () => { testClient = previous; };
}

export function createStripePaymentClient(): StripePaymentClient {
  if (!config.STRIPE_SECRET_KEY) throw new StripePaymentProviderError("Stripe is not configured");
  return new Stripe(config.STRIPE_SECRET_KEY);
}

function toMinorUnits(amount: Decimal): number {
  const minor = amount.mul(100);
  if (!minor.isInteger() || minor.lte(0) || !minor.lte(Number.MAX_SAFE_INTEGER)) {
    throw new StripePaymentProviderError("Invalid payment amount");
  }
  return minor.toNumber();
}

export async function createOrReuseStripePaymentIntent(
  orderId: number,
  userId: number,
  client?: StripePaymentClient,
) {
  const local = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: number; userId: number; status: OrderStatus; totalAmount: Decimal; reservationExpiresAt: Date | null }>>`
      SELECT "id", "userId", "status", "totalAmount", "reservationExpiresAt"
      FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
    `;
    const order = locked[0];
    if (!order) throw new StripePaymentOrderNotFoundError();
    if (order.userId !== userId) throw new StripePaymentOwnershipError();
    if (order.status === OrderStatus.EXPIRED || (order.reservationExpiresAt && order.reservationExpiresAt <= new Date())) throw new StripePaymentExpiredError();
    const amount = toMinorUnits(order.totalAmount);
    const existing = await tx.payment.findUnique({ where: { orderId } });
    if (existing) {
      if (existing.provider !== PaymentProvider.STRIPE) throw new StripePaymentAlreadyCompletedError();
      if (existing.status === PaymentStatus.SUCCEEDED) throw new StripePaymentAlreadyCompletedError();
      return { payment: existing, amount };
    }
    const idempotencyKey = `order-${orderId}-stripe`;
    const payment = await tx.payment.create({ data: { orderId, amount: order.totalAmount, currency: "GBP", provider: PaymentProvider.STRIPE, providerReference: `pending:${idempotencyKey}`, idempotencyKey, status: PaymentStatus.PROCESSING } });
    return { payment, amount };
  });

  let intent: Stripe.PaymentIntent;
  try {
    const providerClient = client ?? testClient ?? createStripePaymentClient();
    const isPending = local.payment.providerReference.startsWith("pending:");
    intent = isPending
      ? await providerClient.paymentIntents.create({ amount: local.amount, currency: "gbp", metadata: { orderId: String(orderId) }, automatic_payment_methods: { enabled: true } }, { idempotencyKey: local.payment.idempotencyKey ?? `order-${orderId}-stripe` })
      : await providerClient.paymentIntents.retrieve(local.payment.providerReference);
  } catch (error) {
    throw new StripePaymentProviderError("Stripe payment operation failed");
  }

  // Initiation/retrieval is not the authoritative payment-success boundary.
  // Verified webhook/reconciliation processing owns SUCCEEDED and paidAt.
  const payment = await prisma.payment.update({ where: { id: local.payment.id }, data: { providerReference: intent.id, status: PaymentStatus.PROCESSING, paidAt: null } });
  return { paymentId: payment.id, providerReference: intent.id, clientSecret: intent.client_secret, status: intent.status };
}
