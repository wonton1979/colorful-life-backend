import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { Decimal } from "@prisma/client/runtime/client";
import { config } from "../config/index.js";
import { prisma } from "../prisma/runtime.js";
import { PaymentProvider, PaymentStatus } from "../generated/prisma-client/enums.js";
import { createOrReuseStripePaymentIntent, createStripePaymentClient } from "../domain/payments/stripePaymentService.js";

const enabled = process.env.RUN_STRIPE_WEBHOOK_E2E_TESTS === "true";
const users: number[] = [];
const orders: number[] = [];
const payments: number[] = [];

async function cleanup() {
  if (payments.length) await prisma.payment.deleteMany({ where: { id: { in: payments } } });
  if (orders.length) await prisma.order.deleteMany({ where: { id: { in: orders } } });
  if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
  payments.length = 0;
  orders.length = 0;
  users.length = 0;
}

afterEach(async () => {
  if (enabled) await cleanup();
});

async function createFixture() {
  const user = await prisma.user.create({
    data: {
      email: `stripe-webhook-sandbox-${randomUUID()}@example.com`,
      passwordHash: "sandbox-webhook-test",
      emailVerified: true,
    },
  });
  users.push(user.id);

  const order = await prisma.order.create({
    data: {
      userId: user.id,
      billingRecipientName: "Stripe Webhook Sandbox",
      billingLine1: "1 Test Street",
      billingCity: "London",
      billingPostcode: "SW1A 1AA",
      billingCountryCode: "GB",
      deliveryRecipientName: "Stripe Webhook Sandbox",
      deliveryLine1: "1 Test Street",
      deliveryCity: "London",
      deliveryPostcode: "SW1A 1AA",
      deliveryCountryCode: "GB",
      totalAmount: new Decimal("5.00"),
    },
  });
  orders.push(order.id);
  return { user, order };
}

async function waitForWebhook(paymentId: number, paymentIntentId: string, baselineEventIds: Set<number>, deadline: number) {
  let latestPayment = await prisma.payment.findUnique({ where: { id: paymentId } });
  let latestEvent: { id: number; processedAt: Date | null; processingError: string | null } | null = null;

  while (Date.now() < deadline) {
    latestPayment = await prisma.payment.findUnique({ where: { id: paymentId } });
    const events = await prisma.paymentWebhookEvent.findMany({
      where: { provider: PaymentProvider.STRIPE, eventType: "payment_intent.succeeded" },
      orderBy: { id: "desc" },
      take: 25,
      select: { id: true, processedAt: true, processingError: true },
    });
    latestEvent = events.find((event) => !baselineEventIds.has(event.id)) ?? null;

    if (
      latestPayment?.status === PaymentStatus.SUCCEEDED &&
      latestPayment.paidAt !== null &&
      latestPayment.providerReference === paymentIntentId &&
      latestEvent?.processedAt !== null &&
      latestEvent?.processingError === null
    ) return { payment: latestPayment, event: latestEvent };

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(JSON.stringify({
    paymentStatus: latestPayment?.status ?? null,
    paidAtPresent: latestPayment?.paidAt !== null,
    providerReferenceMatches: latestPayment?.providerReference === paymentIntentId,
    newMatchingWebhookEvent: latestEvent !== null,
    webhookProcessedAtPresent: latestEvent?.processedAt !== null,
    webhookProcessingError: latestEvent?.processingError ?? null,
  }));
}

describe("Stripe Sandbox payment webhook E2E", { concurrency: 1 }, () => {
  it("confirms a real PaymentIntent and waits for the production webhook path", { skip: !enabled }, async () => {
    if (!config.STRIPE_SECRET_KEY) throw new Error("Stripe webhook Sandbox E2E requires STRIPE_SECRET_KEY");
    if (!config.STRIPE_WEBHOOK_SECRET) throw new Error("Stripe webhook Sandbox E2E requires STRIPE_WEBHOOK_SECRET");
    if (!config.STRIPE_SECRET_KEY.startsWith("sk_test_")) throw new Error("Stripe webhook Sandbox E2E requires a test-mode Stripe key");

    const fixture = await createFixture();
    const baseline = await prisma.paymentWebhookEvent.findMany({
      where: { provider: PaymentProvider.STRIPE, eventType: "payment_intent.succeeded" },
      select: { id: true },
    });
    const baselineEventIds = new Set(baseline.map((event) => event.id));
    const stripe = createStripePaymentClient();
    const initiated = await createOrReuseStripePaymentIntent(fixture.order.id, fixture.user.id);
    assert.match(initiated.providerReference, /^pi_/);

    const localPayment = await prisma.payment.findUnique({ where: { id: initiated.paymentId } });
    assert.equal(localPayment?.provider, PaymentProvider.STRIPE);
    assert.equal(localPayment?.amount.toString(), "5");
    assert.equal(localPayment?.currency, "GBP");
    assert.equal(localPayment?.status, PaymentStatus.PROCESSING);
    assert.ok(localPayment?.idempotencyKey);

    const intent = await stripe.paymentIntents.retrieve(initiated.providerReference);
    assert.equal(intent.amount, 500);
    assert.equal(intent.currency, "gbp");
    assert.equal(intent.metadata.orderId, String(fixture.order.id));
    assert.equal(intent.livemode, false);

    const confirmed = await stripe.paymentIntents.confirm(initiated.providerReference, {
      payment_method: "pm_card_visa",
      return_url: "https://example.com/stripe-sandbox-return",
    });
    assert.equal(confirmed.status, "succeeded");

    await waitForWebhook(initiated.paymentId, initiated.providerReference, baselineEventIds, Date.now() + 90_000);
  });
});
