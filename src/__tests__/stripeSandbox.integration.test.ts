import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import Stripe from "stripe";
import { Decimal } from "@prisma/client/runtime/client";
import { config } from "../config/index.js";
import { prisma } from "../prisma/runtime.js";
import { PaymentProvider, PaymentStatus, RefundProvider, RefundStatus } from "../generated/prisma-client/enums.js";
import { createOrReuseStripePaymentIntent, createStripePaymentClient } from "../domain/payments/stripePaymentService.js";
import { reconcileStripePaymentEvent } from "../domain/payments/stripeReconciliationService.js";
import { createOrReuseStripeRefund } from "../domain/refunds/stripeRefundService.js";

const enabled = process.env.RUN_STRIPE_SANDBOX_TESTS === "true";
const users: number[] = [], orders: number[] = [], payments: number[] = [], refunds: number[] = [];

afterEach(async () => {
  if (!enabled) return;
  if (refunds.length) await prisma.refund.deleteMany({ where: { id: { in: refunds } } });
  if (payments.length) await prisma.payment.deleteMany({ where: { id: { in: payments } } });
  if (orders.length) await prisma.order.deleteMany({ where: { id: { in: orders } } });
  if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
  refunds.length = payments.length = orders.length = users.length = 0;
});

async function fixture() {
  const user = await prisma.user.create({ data: { email: `stripe-sandbox-${randomUUID()}@example.com`, passwordHash: "sandbox-test", emailVerified: true } });
  users.push(user.id);
  const order = await prisma.order.create({ data: { userId: user.id, billingRecipientName: "Sandbox Test", billingLine1: "1 Test Street", billingCity: "London", billingPostcode: "SW1A 1AA", billingCountryCode: "GB", deliveryRecipientName: "Sandbox Test", deliveryLine1: "1 Test Street", deliveryCity: "London", deliveryPostcode: "SW1A 1AA", deliveryCountryCode: "GB", totalAmount: new Decimal("5.00") } });
  orders.push(order.id);
  return { user, order };
}

describe("Stripe Sandbox outbound integration", { concurrency: 1 }, () => {
  it("creates, confirms, refunds, and retries one real Sandbox PaymentIntent", { skip: !enabled }, async () => {
    if (!config.STRIPE_SECRET_KEY) throw new Error("Stripe Sandbox integration requires STRIPE_SECRET_KEY");
    if (!config.STRIPE_SECRET_KEY.startsWith("sk_test_")) throw new Error("Stripe Sandbox integration requires a test-mode Stripe key");

    const f = await fixture();
    const paymentClient = createStripePaymentClient();
    const first = await createOrReuseStripePaymentIntent(f.order.id, f.user.id);
    assert.match(first.providerReference, /^pi_/);
    assert.ok(first.clientSecret);
    const localPayment = await prisma.payment.findUnique({ where: { id: first.paymentId } });
    assert.equal(localPayment?.provider, PaymentProvider.STRIPE);
    assert.equal(localPayment?.status, PaymentStatus.PROCESSING);
    assert.equal(localPayment?.amount.toString(), "5");
    assert.equal(localPayment?.currency, "GBP");
    assert.ok(localPayment?.idempotencyKey);
    assert.equal("clientSecret" in (localPayment ?? {}), false);
    const intent = await paymentClient.paymentIntents.retrieve(first.providerReference);
    assert.equal(intent.amount, 500);
    assert.equal(intent.currency, "gbp");
    assert.equal(intent.metadata.orderId, String(f.order.id));

    const reused = await createOrReuseStripePaymentIntent(f.order.id, f.user.id);
    assert.equal(reused.providerReference, first.providerReference);
    assert.equal(await prisma.payment.count({ where: { orderId: f.order.id } }), 1);
    assert.equal(reused.clientSecret, first.clientSecret);

    const confirmed = await paymentClient.paymentIntents.confirm(first.providerReference, { payment_method: "pm_card_visa", return_url: "https://example.com/stripe-sandbox-return" });
    assert.equal(confirmed.status, "succeeded");
    await reconcileStripePaymentEvent({ id: `sandbox-payment-${randomUUID()}`, type: "payment_intent.succeeded", paymentIntentId: confirmed.id, amount: confirmed.amount, currency: confirmed.currency, metadata: confirmed.metadata });
    const paid = await prisma.payment.findUnique({ where: { id: first.paymentId } });
    assert.equal(paid?.status, PaymentStatus.SUCCEEDED);
    assert.ok(paid?.paidAt);

    const refund = await createOrReuseStripeRefund(f.order.id, first.paymentId, 1, undefined, f.user.id);
    refunds.push(refund.id);
    assert.match(refund.providerReference, /^re_/);
    assert.equal(refund.provider, RefundProvider.STRIPE);
    assert.ok(refund.refundIdempotencyKey);
    assert.equal(refund.status, RefundStatus.SUCCEEDED);
    const providerRefund = await new Stripe(config.STRIPE_SECRET_KEY).refunds.retrieve(refund.providerReference);
    assert.equal((providerRefund.metadata ?? {}).local_refund_id, String(refund.id));
    assert.equal((providerRefund.metadata ?? {}).order_id, String(f.order.id));
    assert.equal(providerRefund.amount, 100);
    assert.equal(providerRefund.currency, "gbp");
    const refunded = await prisma.payment.findUnique({ where: { id: first.paymentId } });
    assert.equal(refunded?.refundedAmount.toString(), "1");
    assert.equal(refunded?.reservedRefundAmount.toString(), "0");

    const retried = await createOrReuseStripeRefund(f.order.id, first.paymentId, 999, undefined, f.user.id, undefined, refund.id);
    assert.equal(retried.id, refund.id);
    assert.equal(retried.providerReference, refund.providerReference);
    assert.equal(await prisma.refund.count({ where: { paymentId: first.paymentId } }), 1);
    assert.equal((await prisma.payment.findUnique({ where: { id: first.paymentId } }))?.refundedAmount.toString(), "1");
  });
});
