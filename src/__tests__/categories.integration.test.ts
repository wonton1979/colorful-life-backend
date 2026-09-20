import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, afterEach, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { config } from "../config/index.js";
import { prisma } from "../prisma/runtime.js";

const productIds: number[] = [];
const listingIds: number[] = [];
const userIds: number[] = [];
const categoryIds: number[] = [];
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
  if (listingIds.length) await prisma.productListing.deleteMany({ where: { id: { in: listingIds } } });
  if (productIds.length) await prisma.legoProduct.deleteMany({ where: { id: { in: productIds } } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (categoryIds.length) await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  listingIds.length = productIds.length = userIds.length = categoryIds.length = 0;
});

after(async () => { await prisma.$disconnect(); server.close(); });

function request(path: string, token?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  return fetch(`${url}${path}`, { ...init, headers });
}

async function makeAdmin() {
  const user = await prisma.user.create({
    data: { email: `category-admin-${randomUUID()}@example.com`, passwordHash: "test-hash", role: "ADMIN" },
  });
  userIds.push(user.id);
  return jwt.sign({ id: user.id, role: "ADMIN" }, config.JWT_SECRET, { expiresIn: "1h" });
}

describe("Category public contract", () => {
  it("returns the 13 mapped categories in catalogue order without public image IDs", async () => {
    const response = await request("/categories");
    assert.equal(response.status, 200);
    const categories = await response.json();
    assert.equal(categories.length, 13);
    assert.deepEqual(categories.map((category: { name: string }) => category.name), [
      "Harry Potter", "Star Wars", "Friends", "City", "Disney", "Marvel",
      "Jurassic World", "Flowers & Botanicals", "NINJAGO", "DC & Batman",
      "Vehicles", "Creator", "Others",
    ]);
    assert.ok(categories.every((category: Record<string, unknown>) =>
      "id" in category && "name" in category && "subtitle" in category &&
      "description" in category && "imageUrl" in category && !("imagePublicId" in category)));
  });

  it("creates a product by Category identity and returns the related category", async () => {
    const token = await makeAdmin();
    const vehicles = await prisma.category.findUniqueOrThrow({ where: { name: "Vehicles" } });
    const setNumber = `CATEGORY-${randomUUID()}`;
    const response = await request("/products", token, {
      method: "POST",
      body: JSON.stringify({
        setNumber, title: "Category contract", theme: "Technic", ageRecommendation: "8+",
        pieceCount: 100, categoryId: vehicles.id, condition: "NEW", originalPrice: 20,
      }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    productIds.push(body.legoProductId);
    listingIds.push(body.id);
    assert.deepEqual(body.category, { id: vehicles.id, name: "Vehicles", subtitle: "Built for the thrill", description: null, imageUrl: null });
    assert.equal(body.legoProduct.categoryId, vehicles.id);
  });

  it("rejects a nonexistent Category without creating a product", async () => {
    const token = await makeAdmin();
    const setNumber = `CATEGORY-INVALID-${randomUUID()}`;
    const response = await request("/products", token, {
      method: "POST",
      body: JSON.stringify({
        setNumber, title: "Invalid category", theme: "Test", ageRecommendation: "8+",
        pieceCount: 10, categoryId: 999999999, condition: "NEW", originalPrice: 20,
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(await prisma.legoProduct.count({ where: { setNumber } }), 0);
  });

  it("assigns a newly created arbitrary Category without a legacy enum mapping", async () => {
    const token = await makeAdmin();
    const category = await prisma.category.create({
      data: { name: `Space Adventures ${randomUUID()}`, subtitle: "Beyond the stars" },
    });
    categoryIds.push(category.id);
    const response = await request("/products", token, {
      method: "POST",
      body: JSON.stringify({
        setNumber: `CATEGORY-ARBITRARY-${randomUUID()}`, title: "Space explorer", theme: "Test",
        ageRecommendation: "8+", pieceCount: 10, categoryId: category.id, condition: "NEW", originalPrice: 20,
      }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    productIds.push(body.legoProductId);
    listingIds.push(body.id);
    assert.equal(body.category.id, category.id);
    assert.equal(body.category.name, category.name);
  });
});

describe("Category relation catalogue and feature behavior", () => {
  it("filters and scopes feature selection through LegoProduct.category", async () => {
    const token = await makeAdmin();
    const vehicles = await prisma.category.findUniqueOrThrow({ where: { name: "Vehicles" } });
    const products = await Promise.all(["A", "B"].map((suffix) => prisma.legoProduct.create({
      data: {
        setNumber: `CATEGORY-FEATURE-${suffix}-${randomUUID()}`, title: `Feature ${suffix}`,
        theme: "Test", ageRecommendation: "8+", pieceCount: 10, categoryId: vehicles.id,
      },
    })));
    productIds.push(...products.map((product) => product.id));
    const listings = await Promise.all(products.map((product) => prisma.productListing.create({
      data: { legoProductId: product.id, condition: "NEW", originalPrice: 10, currentStock: 1 },
    })));
    listingIds.push(...listings.map((listing) => listing.id));

    const filtered = await request(`/products?categoryId=${vehicles.id}&q=${encodeURIComponent("CATEGORY-FEATURE")}`);
    assert.equal(filtered.status, 200);
    assert.equal((await filtered.json()).items.length, 2);
    assert.equal((await request(`/products/${listings[0].id}/feature`, token, { method: "PATCH" })).status, 200);
    assert.equal((await request(`/products/${listings[1].id}/feature`, token, { method: "PATCH" })).status, 200);
    const state = await prisma.productListing.findMany({ where: { id: { in: listings.map((listing) => listing.id) } }, orderBy: { id: "asc" } });
    assert.equal(state.filter((listing) => listing.isFeatureProduct).length, 1);
  });
});
