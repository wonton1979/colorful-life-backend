import { strict as assert } from "node:assert";
import { after, afterEach, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { Decimal } from "@prisma/client/runtime/client";
import app from "../app.js";
import { config } from "../config/index.js";
import { prisma } from "../prisma/runtime.js";

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
      addresses: {
        create: {
          recipientName: "HTTP Customer",
          line1: "1 Test Street",
          city: "Testville",
          postcode: "T1",
          countryCode: "GB",
          isDefaultBilling: true,
        },
      },
    },
  });
  userIds.push(user.id);
  return { ...user, token: jwt.sign({ id: user.id, role: user.role }, config.JWT_SECRET, { expiresIn: "1h" }) };
}

async function makeListing() {
  const product = await prisma.legoProduct.create({
    data: {
      setNumber: `CREATE-${randomUUID()}`,
      title: "HTTP Creation Product",
      theme: "TEST",
      ageRecommendation: "8+",
      pieceCount: 100,
    },
  });
  productIds.push(product.id);
  const listing = await prisma.productListing.create({
    data: { legoProductId: product.id, condition: "NEW", originalPrice: new Decimal(20), salePrice: new Decimal(15), currentStock: 7, active: true },
  });
  listingIds.push(listing.id);
  return listing;
}

describe("order creation HTTP integration", () => {
  it("authenticated customer creates an order through POST /orders", async () => {
    const customer = await makeCustomer();
    const listing = await makeListing();
    const response = await fetch(`${url}/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${customer.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ productListingId: listing.id, quantity: 2 }] }),
    });
    assert.strictEqual(response.status, 201);
    const body = await response.json();
    orderIds.push(body.id);
    assert.strictEqual(body.userId, customer.id);
    assert.strictEqual(body.orderItems.length, 1);
    assert.strictEqual(body.orderItems[0].productListingId, listing.id);
    assert.strictEqual(body.orderItems[0].quantity, 2);
    assert.strictEqual(body.orderItems[0].unitPrice, "15");
    assert.strictEqual(body.orderItems[0].lineTotal, "30");
    const persisted = await prisma.order.findUnique({ where: { id: body.id } });
    assert.strictEqual(persisted?.userId, customer.id);
    assert.strictEqual((await prisma.productListing.findUnique({ where: { id: listing.id } }))?.currentStock, 7);
  });

  it("rejects unauthenticated order creation", async () => {
    const response = await fetch(`${url}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [] }) });
    assert.strictEqual(response.status, 401);
  });
});
