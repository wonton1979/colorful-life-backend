import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { PaymentProvider, PaymentStatus, RefundProvider } from "../generated/prisma-client/enums.js";
import { prisma } from "../prisma/runtime.js";

describe("payment provider persistence foundation", () => {
  const eventIds: number[] = [];
  after(async () => { if (eventIds.length) await prisma.paymentWebhookEvent.deleteMany({ where: { id: { in: eventIds } } }); });

  it("exposes asynchronous provider and lifecycle enum values", () => {
    assert.deepEqual([PaymentProvider.MANUAL, PaymentProvider.STRIPE, PaymentProvider.PAYPAL], ["MANUAL", "STRIPE", "PAYPAL"]);
    assert.equal(PaymentStatus.PROCESSING, "PROCESSING");
    assert.equal(PaymentStatus.CANCELED, "CANCELED");
    assert.equal(RefundProvider.STRIPE, "STRIPE"); assert.equal(RefundProvider.PAYPAL, "PAYPAL");
  });

  it("deduplicates webhook event IDs per provider", async () => {
    const eventId = `foundation-${randomUUID()}`;
    const first = await prisma.paymentWebhookEvent.create({ data: { provider: PaymentProvider.STRIPE, providerEventId: eventId, eventType: "payment_intent.succeeded" } }); eventIds.push(first.id);
    await assert.rejects(() => prisma.paymentWebhookEvent.create({ data: { provider: PaymentProvider.STRIPE, providerEventId: eventId, eventType: "payment_intent.succeeded" } }));
    const otherProvider = await prisma.paymentWebhookEvent.create({ data: { provider: PaymentProvider.PAYPAL, providerEventId: eventId, eventType: "PAYMENT.CAPTURE.COMPLETED" } }); eventIds.push(otherProvider.id);
  });
});
