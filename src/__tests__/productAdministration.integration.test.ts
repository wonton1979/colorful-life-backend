import { strict as assert } from "node:assert";
import { after, afterEach, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { config } from "../config/index.js";
import { prisma } from "../prisma/runtime.js";

const userIds: number[] = [];
const productIds: number[] = [];
const listingIds: number[] = [];
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
  if (listingIds.length) {
    await prisma.inventoryMovement.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.productListing.deleteMany({ where: { id: { in: listingIds } } });
  }
  if (productIds.length) await prisma.legoProduct.deleteMany({ where: { id: { in: productIds } } });
  if (userIds.length) {
    await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  userIds.length = productIds.length = listingIds.length = 0;
});

after(async () => {
  await prisma.$disconnect();
  server.close();
});

async function makeUser(role: "ADMIN" | "CUSTOMER") {
  const user = await prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${randomUUID()}@example.com`,
      passwordHash: "test-hash",
      role,
      addresses: { create: { recipientName: role, line1: "1 Test Street", city: "Testville", postcode: "T1", countryCode: "GB", isDefaultBilling: true } },
    },
  });
  userIds.push(user.id);
  return { id: user.id, token: jwt.sign({ id: user.id, role }, config.JWT_SECRET, { expiresIn: "1h" }) };
}

async function makeListing() {
  const product = await prisma.legoProduct.create({
    data: { setNumber: `ADMIN-${randomUUID()}`, title: "Administration Product", theme: "TEST", ageRecommendation: "8+", pieceCount: 100 },
  });
  productIds.push(product.id);
  const listing = await prisma.productListing.create({
    data: { legoProductId: product.id, condition: "NEW", originalPrice: 20, currentStock: 3, active: true },
  });
  listingIds.push(listing.id);
  return listing;
}

function request(path: string, token: string | undefined, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  return fetch(`${url}${path}`, { ...init, headers });
}

const productBody = {
  setNumber: "ADMIN-ROUTED-UNIQUE",
  title: "Created Product",
  theme: "TEST",
  ageRecommendation: "8+",
  pieceCount: 50,
  condition: "NEW",
  originalPrice: 12,
  currentStock: 2,
};

describe("product administration authorization", () => {
  it("keeps catalogue reads public and protects every administration surface", async () => {
    const admin = await makeUser("ADMIN");
    const customer = await makeUser("CUSTOMER");
    const listing = await makeListing();

    assert.strictEqual((await request("/products", undefined)).status, 200);
    assert.strictEqual((await request(`/products/${listing.id}`, undefined)).status, 200);

    const protectedRequests: Array<{ path: string; method: string; body?: unknown }> = [
      { path: "/products", method: "POST", body: productBody },
      { path: `/products/${listing.id}`, method: "PATCH", body: { title: "Changed" } },
      { path: `/products/${listing.id}/deactivate`, method: "PATCH" },
      { path: `/products/${listing.id}/reactivate`, method: "PATCH" },
      { path: `/products/${listing.id}/inventory-adjustments`, method: "POST", body: { quantity: 1 } },
      { path: `/products/${listing.id}/inventory-movements`, method: "GET" },
    ];
    for (const target of protectedRequests) {
      const body = target.body === undefined ? undefined : JSON.stringify(target.body);
      assert.strictEqual((await request(target.path, undefined, { method: target.method, body })).status, 401);
      assert.strictEqual((await request(target.path, customer.token, { method: target.method, body })).status, 403);
    }

    const createdResponse = await request("/products", admin.token, { method: "POST", body: JSON.stringify(productBody) });
    assert.strictEqual(createdResponse.status, 201);
    const created = await createdResponse.json();
    listingIds.push(created.id);
    productIds.push(created.legoProductId);

    assert.strictEqual((await request(`/products/${listing.id}`, admin.token, { method: "PATCH", body: JSON.stringify({ title: "Updated Product" }) })).status, 200);
    assert.strictEqual((await request(`/products/${listing.id}/deactivate`, admin.token, { method: "PATCH" })).status, 200);
    assert.strictEqual((await request(`/products/${listing.id}/reactivate`, admin.token, { method: "PATCH" })).status, 200);
    assert.strictEqual((await request(`/products/${listing.id}/inventory-adjustments`, admin.token, { method: "POST", body: JSON.stringify({ quantity: 1 }) })).status, 200);
    const movementsResponse = await request(`/products/${listing.id}/inventory-movements`, admin.token);
    assert.strictEqual(movementsResponse.status, 200);
    assert.strictEqual((await movementsResponse.json()).movements.length, 1);
  });
});
