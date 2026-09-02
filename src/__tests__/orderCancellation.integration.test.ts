import { strict as assert } from "node:assert";
import { after, afterEach, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { Decimal } from "@prisma/client/runtime/client";
import app from "../app.js";
import { config } from "../config/index.js";
import { prisma } from "../prisma/runtime.js";
import { InventoryMovementType } from "../generated/prisma-client/enums.js";

const userIds: number[] = [];
const productIds: number[] = [];
const listingIds: number[] = [];
const orderIds: number[] = [];
let server: Server;
let url: string;

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  url = `http://localhost:${address.port}`;
});

afterEach(async () => {
  if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  if (listingIds.length) await prisma.inventoryMovement.deleteMany({ where: { listingId: { in: listingIds } } });
  if (listingIds.length) await prisma.productListing.deleteMany({ where: { id: { in: listingIds } } });
  if (productIds.length) await prisma.legoProduct.deleteMany({ where: { id: { in: productIds } } });
  if (userIds.length) {
    await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  orderIds.length = listingIds.length = productIds.length = userIds.length = 0;
});

after(async () => {
  await prisma.$disconnect();
  server.close();
});

async function makeCustomer() {
  const user = await prisma.user.create({
    data: {
      email: `${randomUUID()}@example.com`,
      passwordHash: "test-hash",
      role: "CUSTOMER",
      emailVerified: true,
      addresses: { create: { recipientName: "Customer", line1: "1 Test Street", city: "Testville", postcode: "T1", countryCode: "GB", isDefaultBilling: true } },
    },
  });
  userIds.push(user.id);
  return { id: user.id, token: jwt.sign({ id: user.id, role: "CUSTOMER" }, config.JWT_SECRET, { expiresIn: "1h" }) };
}

async function makeOrder(userId: number, status: "PENDING" | "DISPATCHED" = "PENDING") {
  const product = await prisma.legoProduct.create({
    data: { setNumber: `CANCEL-${randomUUID()}`, title: "Cancellation Product", theme: "TEST", ageRecommendation: "8+", pieceCount: 100 },
  });
  productIds.push(product.id);
  const listing = await prisma.productListing.create({ data: { legoProductId: product.id, condition: "NEW", originalPrice: new Decimal(20), currentStock: 4, reservedStock: 1, active: true } });
  listingIds.push(listing.id);
  const order = await prisma.order.create({
    data: {
      userId,
      billingRecipientName: "Customer",
      billingLine1: "1 Test Street",
      billingCity: "Testville",
      billingPostcode: "T1",
      billingCountryCode: "GB",
      deliveryRecipientName: "Customer",
      deliveryLine1: "1 Test Street",
      deliveryCity: "Testville",
      deliveryPostcode: "T1",
      deliveryCountryCode: "GB",
      status,
      totalAmount: 20,
      orderItems: { create: { productListingId: listing.id, quantity: 1, unitPrice: 20, lineTotal: 20 } },
    },
  });
  orderIds.push(order.id);
  return order;
}

function cancel(orderId: number, token: string | undefined, reason = "CHANGED_MIND") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${url}/orders/${orderId}/cancel`, { method: "POST", headers, body: JSON.stringify({ reason }) });
}

describe("customer order cancellation HTTP integration", () => {
  it("allows an authenticated customer to cancel their own PENDING order", async () => {
    const customer = await makeCustomer();
    const order = await makeOrder(customer.id);
    const response = await cancel(order.id, customer.token);
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.strictEqual(body.id, order.id);
    assert.strictEqual(body.status, "CANCELLED");
    assert.strictEqual(body.cancelledBy, "CUSTOMER");
    assert.strictEqual(body.cancellationReason, "CHANGED_MIND");
    const persisted = await prisma.order.findUnique({ where: { id: order.id } });
    assert.strictEqual(persisted?.status, "CANCELLED");
  });

  it("returns 404 for another customer's order and 401 without authentication", async () => {
    const owner = await makeCustomer();
    const other = await makeCustomer();
    const order = await makeOrder(owner.id);
    assert.strictEqual((await cancel(order.id, other.token)).status, 404);
    assert.strictEqual((await cancel(order.id, undefined)).status, 401);
    assert.strictEqual((await prisma.order.findUnique({ where: { id: order.id } }))?.status, "PENDING");
  });

  it("restores stock and records a movement when a customer cancels a CONFIRMED order", async () => {
    const customer = await makeCustomer();
    const order = await makeOrder(customer.id);
    const listingId = (await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).productListingId;
    const before = (await prisma.productListing.findUnique({ where: { id: listingId } }))!.currentStock;
    await prisma.productListing.update({ where: { id: listingId }, data: { currentStock: { decrement: 1 }, reservedStock: { decrement: 1 } } });
    await prisma.order.update({ where: { id: order.id }, data: { status: "CONFIRMED" } });
    const response = await cancel(order.id, customer.token);
    assert.strictEqual(response.status, 200);
    assert.strictEqual((await prisma.productListing.findUnique({ where: { id: listingId } }))!.currentStock, before);
    const movements = await prisma.inventoryMovement.findMany({ where: { listingId, type: InventoryMovementType.ORDER_CANCELLATION_RETURN } });
    assert.strictEqual(movements.length, 1);
    assert.strictEqual(movements[0].quantityChange, 1);
    assert.strictEqual(movements[0].performedByUserId, customer.id);
  });

  it("rejects cancellation of a non-cancellable order", async () => {
    const customer = await makeCustomer();
    const order = await makeOrder(customer.id, "DISPATCHED");
    const response = await cancel(order.id, customer.token);
    assert.strictEqual(response.status, 400);
    assert.strictEqual((await prisma.order.findUnique({ where: { id: order.id } }))?.status, "DISPATCHED");
  });

  it("keeps the ADMIN seller-cancellation route separate", async () => {
    const admin = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, passwordHash: "test-hash", role: "ADMIN" } });
    userIds.push(admin.id);
    const order = await makeOrder(admin.id);
    const response = await fetch(`${url}/orders/${order.id}/seller-cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt.sign({ id: admin.id, role: "ADMIN" }, config.JWT_SECRET, { expiresIn: "1h" })}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "OUT_OF_STOCK" }),
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual((await response.json()).cancelledBy, "SELLER");
  });
});
