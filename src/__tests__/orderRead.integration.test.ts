import { strict as assert } from "node:assert";
import { after, afterEach, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { config } from "../config/index.js";
import { prisma } from "../prisma/runtime.js";
import { createOrder } from "../domain/orders/orderService.js";
import { OrderStatus } from "../generated/prisma-client/enums.js";

const userIds: number[] = [];
const productIds: number[] = [];
const listingIds: number[] = [];
const orderIds: number[] = [];
let server: ReturnType<typeof app.listen>;
let url: string;

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  url = `http://localhost:${address.port}`;
});

after(async () => {
  await prisma.$disconnect();
  server.close();
});

afterEach(async () => {
  if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  if (listingIds.length) await prisma.productListing.deleteMany({ where: { id: { in: listingIds } } });
  if (productIds.length) await prisma.legoProduct.deleteMany({ where: { id: { in: productIds } } });
  if (userIds.length) {
    await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  orderIds.length = listingIds.length = productIds.length = userIds.length = 0;
});

async function makeUser() {
  const user = await prisma.user.create({
    data: {
      email: `${randomUUID()}@example.com`,
      passwordHash: "secret-hash",
      emailVerified: true,
      role: "CUSTOMER",
      addresses: { create: { recipientName: "Customer", line1: "1 Test Street", city: "Testville", postcode: "T1", countryCode: "GB", isDefaultBilling: true } },
    },
  });
  userIds.push(user.id);
  return { ...user, token: jwt.sign({ id: user.id, role: "CUSTOMER" }, config.JWT_SECRET, { expiresIn: "1h" }) };
}

async function makeListing() {
  const product = await prisma.legoProduct.create({ data: { setNumber: `READ-${randomUUID()}`, title: "Read Product", theme: "TEST", ageRecommendation: "8+", pieceCount: 100 } });
  productIds.push(product.id);
  const listing = await prisma.productListing.create({ data: { legoProductId: product.id, condition: "NEW", originalPrice: 20, salePrice: 15, currentStock: 4 } });
  listingIds.push(listing.id);
  return listing;
}

async function makeOrder(customerId: number, listingId: number) {
  const order = await createOrder(customerId, { items: [{ productListingId: listingId, quantity: 2 }] });
  orderIds.push(order.id);
  return order;
}

async function get(token: string | undefined, path: string) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${url}${path}`, { headers });
}

describe("customer order reads", () => {
  it("lists only the authenticated customer's orders and returns [] when empty", async () => {
    const customer = await makeUser();
    assert.deepStrictEqual(await (await get(customer.token, "/orders")).json(), []);
    const listing = await makeListing();
    const order = await makeOrder(customer.id, listing.id);
    const other = await makeUser();
    const otherListing = await makeListing();
    await makeOrder(other.id, otherListing.id);
    const response = await get(customer.token, "/orders");
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0].id, order.id);
  });

  it("reads an owned order with safe item, status, and total fields", async () => {
    const customer = await makeUser();
    const listing = await makeListing();
    const order = await makeOrder(customer.id, listing.id);
    const response = await get(customer.token, `/orders/${order.id}`);
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.deepStrictEqual({ id: body.id, status: body.status, totalAmount: body.totalAmount, itemQuantity: body.orderItems[0].quantity, unitPrice: body.orderItems[0].unitPrice, lineTotal: body.orderItems[0].lineTotal }, { id: order.id, status: "PENDING", totalAmount: "30", itemQuantity: 2, unitPrice: "15", lineTotal: "30" });
    assert.strictEqual(body.orderItems[0].productListing.legoProduct.title, "Read Product");
    assert.strictEqual(body.actualShippingCost, undefined);
    assert.strictEqual(body.user, undefined);
    assert.strictEqual(body.passwordHash, undefined);
    assert.strictEqual(body.inventoryMovements, undefined);
    assert.strictEqual(body.inventoryAudits, undefined);
    assert.strictEqual(body.payments, undefined);
    assert.strictEqual(body.refunds, undefined);
    assert.strictEqual(body.returns, undefined);
  });

  it("returns dispatch and completion fields but not actual shipping cost", async () => {
    const customer = await makeUser();
    const listing = await makeListing();
    const order = await makeOrder(customer.id, listing.id);
    const dispatchedAt = new Date("2026-09-01T10:00:00.000Z");
    const completedAt = new Date("2026-09-02T10:00:00.000Z");
    await prisma.order.update({ where: { id: order.id }, data: { status: OrderStatus.COMPLETED, shippingCarrier: "UPS", trackingNumber: "TRACK", dispatchedAt, completedAt, actualShippingCost: 8 } });
    const body = await (await get(customer.token, `/orders/${order.id}`)).json();
    assert.strictEqual(body.status, "COMPLETED");
    assert.strictEqual(body.shippingCarrier, "UPS");
    assert.strictEqual(body.trackingNumber, "TRACK");
    assert.strictEqual(new Date(body.dispatchedAt).toISOString(), dispatchedAt.toISOString());
    assert.strictEqual(new Date(body.completedAt).toISOString(), completedAt.toISOString());
    assert.strictEqual(body.actualShippingCost, undefined);
  });

  it("returns the same 404 for another customer's or missing order", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const listing = await makeListing();
    const order = await makeOrder(owner.id, listing.id);
    assert.strictEqual((await get(other.token, `/orders/${order.id}`)).status, 404);
    assert.strictEqual((await get(other.token, "/orders/2147483647")).status, 404);
  });

  it("rejects malformed and unauthenticated reads", async () => {
    assert.strictEqual((await get(undefined, "/orders")).status, 401);
    assert.strictEqual((await get(undefined, "/orders/1")).status, 401);
    const customer = await makeUser();
    assert.strictEqual((await get(customer.token, "/orders/not-an-id")).status, 400);
  });

});
