import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, afterEach, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import app from "../app.js";
import { prisma } from "../prisma/runtime.js";
import { Decimal } from "@prisma/client/runtime/client";

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
  if (listingIds.length) await prisma.productListing.deleteMany({ where: { id: { in: listingIds } } });
  if (productIds.length) await prisma.legoProduct.deleteMany({ where: { id: { in: productIds } } });
  listingIds.length = productIds.length = 0;
});

after(async () => { await prisma.$disconnect(); server.close(); });

async function makeListing(data: { setNumber: string; title: string; theme: string; originalPrice: number; category?: "VEHICLES" | "CITY" | "OTHERS"; salePrice?: number; active?: boolean; createdAt?: Date; currentStock?: number; reservedStock?: number; isRetired?: boolean }) {
  const category = await prisma.category.findUniqueOrThrow({ where: { name: data.category === "VEHICLES" ? "Vehicles" : data.category === "CITY" ? "City" : "Others" } });
  const product = await prisma.legoProduct.create({
    data: { setNumber: data.setNumber, title: data.title, theme: data.theme, ageRecommendation: "8+", pieceCount: 100, categoryId: category.id, isRetired: data.isRetired },
  });
  productIds.push(product.id);
  const listing = await prisma.productListing.create({
    data: {
        legoProductId: product.id, condition: "NEW", originalPrice: new Decimal(data.originalPrice), salePrice: data.salePrice === undefined ? null : new Decimal(data.salePrice), currentStock: data.currentStock ?? 1, reservedStock: data.reservedStock ?? 0, active: data.active ?? true, createdAt: data.createdAt },
  });
  listingIds.push(listing.id);
  return listing;
}

async function get(path: string) {
  const response = await fetch(`${url}${path}`);
  const body = await response.json();
  return { response, body };
}

describe("Product catalogue HTTP integration", () => {
  for (const { name, currentStock, reservedStock, expected } of [
    { name: "unreserved stock", currentStock: 7, reservedStock: 0, expected: 7 },
    { name: "partially reserved stock", currentStock: 7, reservedStock: 3, expected: 4 },
    { name: "fully reserved stock", currentStock: 7, reservedStock: 7, expected: 0 },
    { name: "empty stock", currentStock: 0, reservedStock: 0, expected: 0 },
    { name: "inconsistent excess reservations", currentStock: 2, reservedStock: 5, expected: 0 },
  ]) {
    it(`exposes non-negative availableStock for ${name} without exposing reservations`, async () => {
      const setNumber = `STOCK-${randomUUID()}`;
      const listing = await makeListing({ setNumber, title: "Stock availability", theme: "City", originalPrice: 10, currentStock, reservedStock });
      const { response, body } = await get(`/products?q=${setNumber}`);
      assert.strictEqual(response.status, 200);
      if (expected === 0) { assert.strictEqual(body.items.length, 0); return; }
      assert.strictEqual(body.items.length, 1);
      const item = body.items[0];
      assert.strictEqual(item.id, listing.legoProductId);
      assert.strictEqual(item.offers.length, 1);
      assert.strictEqual(item.offers[0].id, listing.id);
      assert.strictEqual(item.offers[0].availableStock, expected);
      assert.strictEqual(item.offers[0].currentStock, currentStock);
      assert.ok(!Object.hasOwn(item.offers[0], "reservedStock"));
    });
  }

  it("preserves existing catalogue fields, serialization, and ordered listing images", async () => {
    const setNumber = `CONTRACT-${randomUUID()}`;
    const listing = await makeListing({ setNumber, title: "Catalogue contract", theme: "City", originalPrice: 12.5, salePrice: 9.25, currentStock: 6, reservedStock: 2 });
    const laterImage = await prisma.listingImage.create({ data: { listingId: listing.id, url: "https://cdn.example/later.jpg", publicId: `later-${listing.id}`, sortOrder: 2 } });
    const firstImage = await prisma.listingImage.create({ data: { listingId: listing.id, url: "https://cdn.example/first.jpg", publicId: `first-${listing.id}`, sortOrder: 1, altText: "First image" } });
    const product = await prisma.legoProduct.findUniqueOrThrow({ where: { id: listing.legoProductId } });
    const { response, body } = await get(`/products?q=${setNumber}`);
    assert.strictEqual(response.status, 200);
    assert.equal(body.items.length, 1);
    const item = body.items[0];
    assert.equal(item.id, listing.legoProductId);
    assert.equal(item.setNumber, product.setNumber);
    assert.equal(item.title, product.title);
    assert.equal(item.isRetired, false);
    assert.equal(item.category.name, "Others");
    assert.equal(item.offers.length, 1);
    assert.equal(item.offers[0].id, listing.id);
    assert.equal(item.offers[0].condition, "NEW");
    assert.equal(item.offers[0].availableStock, 4);
    assert.deepEqual(item.offers[0].listingImages.map((image: any) => image.id), [firstImage.id, laterImage.id]);
  });

  it("reads current inventory on each request without changing stock", async () => {
    const setNumber = `LIVE-STOCK-${randomUUID()}`;
    const listing = await makeListing({ setNumber, title: "Changing inventory", theme: "City", originalPrice: 10, currentStock: 8, reservedStock: 3 });
    const path = `/products?q=${setNumber}`;
    const first = await get(path);
    assert.strictEqual(first.body.items[0].offers[0].availableStock, 5);
    assert.deepStrictEqual((await get(path)).body, first.body);
    assert.equal((await prisma.productListing.findUnique({ where: { id: listing.id } }))?.currentStock, listing.currentStock);

    await prisma.productListing.update({ where: { id: listing.id }, data: { reservedStock: 6 } });
    assert.strictEqual((await get(path)).body.items[0].offers[0].availableStock, 2);
    await prisma.productListing.update({ where: { id: listing.id }, data: { currentStock: 2, reservedStock: 0 } });
    assert.strictEqual((await get(path)).body.items[0].offers[0].availableStock, 2);
  });

  for (const isRetired of [false, true]) {
    it(`preserves catalogue eligibility and price filters with isRetired=${isRetired}`, async () => {
      const prefix = `RETIREMENT-${randomUUID()}`;
      const available = await makeListing({ setNumber: `${prefix}-available`, title: "Available", theme: "City", originalPrice: 20, salePrice: 12, currentStock: 3, reservedStock: 1, isRetired });
      await makeListing({ setNumber: `${prefix}-inactive`, title: "Inactive", theme: "City", originalPrice: 12, active: false, isRetired });
      await makeListing({ setNumber: `${prefix}-empty`, title: "Empty", theme: "City", originalPrice: 12, currentStock: 0, isRetired });
      await makeListing({ setNumber: `${prefix}-reserved`, title: "Reserved", theme: "City", originalPrice: 12, currentStock: 1, reservedStock: 1, isRetired });
      const catalogue = await get(`/products?q=${prefix}&minPrice=12&maxPrice=12`);
      assert.equal(catalogue.response.status, 200);
      assert.equal(catalogue.body.pagination.totalItems, 1);
      assert.deepEqual(catalogue.body.items.map((item: any) => item.id), [available.legoProductId]);
      assert.equal(catalogue.body.items[0].isRetired, isRetired);
      assert.equal(catalogue.body.items[0].offers[0].availableStock, 2);
      assert.equal(Number(catalogue.body.items[0].offers[0].effectivePrice), 12);
      assert.deepEqual((await get(`/products?q=${prefix}&minPrice=13`)).body.items, []);
      const detail = await get(`/products/by-product/${available.legoProductId}`);
      assert.equal(detail.response.status, 200);
      assert.equal(detail.body.isRetired, isRetired);
      assert.deepEqual(detail.body.offers, catalogue.body.items[0].offers);
    });
  }

  it("is public and returns the default paginated active catalogue", async () => {
    await makeListing({ setNumber: `CAT-${randomUUID()}`, title: "Active", theme: "City", originalPrice: 10 });
    await makeListing({ setNumber: `CAT-${randomUUID()}`, title: "Inactive", theme: "City", originalPrice: 20, active: false });
    const { response, body } = await get("/products");
    assert.strictEqual(response.status, 200);
    assert.ok(Array.isArray(body.items));
    assert.strictEqual(body.pagination.page, 1);
    assert.strictEqual(body.pagination.pageSize, 20);
    assert.ok(body.pagination.totalItems >= 1);
    assert.ok(body.items.some((item: any) => item.title === "Active"));
    assert.equal(body.items.find((item: any) => item.title === "Active").category.name, "Others");
    assert.ok(!body.items.some((item: any) => item.title === "Inactive"));
  });

  it("searches set number/title case-insensitively and filters theme", async () => {
    const suffix = randomUUID();
    await makeListing({ setNumber: `ZX-${suffix}`, title: "Space Explorer", theme: "Space", originalPrice: 10 });
    await makeListing({ setNumber: `OTHER-${suffix}`, title: "Castle Explorer", theme: "Castle", originalPrice: 10 });
    assert.strictEqual((await get(`/products?q=${encodeURIComponent(`zx-${suffix.slice(0, 8)}`)}`)).body.pagination.totalItems, 1);
    assert.strictEqual((await get("/products?q=SPACE%20EXPLORER")).body.pagination.totalItems, 1);
    assert.strictEqual((await get("/products?theme=space")).body.pagination.totalItems, 1);
  });

  it("uses effective prices and supports combined filters and pagination", async () => {
    const suffix = randomUUID();
    await makeListing({ setNumber: `P1-${suffix}`, title: "Set One", theme: "Technic", originalPrice: 100, salePrice: 20, createdAt: new Date("2020-01-01") });
    await makeListing({ setNumber: `P2-${suffix}`, title: "Set Two", theme: "Technic", originalPrice: 30, createdAt: new Date("2020-01-02"), currentStock: 4, reservedStock: 2 });
    await makeListing({ setNumber: `P3-${suffix}`, title: "Set Three", theme: "Technic", originalPrice: 40, salePrice: 35, createdAt: new Date("2020-01-03"), currentStock: 3, reservedStock: 3 });
    const filtered = await get(`/products?theme=TECHNIC&minPrice=20&maxPrice=35&page=1&pageSize=2`);
    assert.deepStrictEqual(filtered.body.pagination, { page: 1, pageSize: 2, totalItems: 2, totalPages: 1 });
    assert.deepStrictEqual(filtered.body.items.map((item: any) => item.setNumber), [`P2-${suffix}`, `P1-${suffix}`]);
    assert.deepStrictEqual(filtered.body.items.map((item: any) => item.offers[0].availableStock), [2, 1]);
    const second = await get(`/products?theme=TECHNIC&minPrice=20&maxPrice=35&page=2&pageSize=2`);
    assert.deepStrictEqual(second.body.items.map((item: any) => item.setNumber), []);
    assert.deepStrictEqual(second.body.items.map((item: any) => item.offers[0].availableStock), []);
    assert.strictEqual((await get(`/products?theme=TECHNIC&minPrice=20&maxPrice=35&page=3&pageSize=2`)).body.items.length, 0);
  });

  it("rejects invalid pagination and price parameters and ignores empty search filters", async () => {
    for (const query of ["page=0", "page=1.5", "pageSize=101", "pageSize=0", "minPrice=x", "maxPrice=-1", "minPrice=5&maxPrice=4", "categoryId=0", "categoryId=not-a-number"]) {
      assert.strictEqual((await get(`/products?${query}`)).response.status, 400, query);
    }
    assert.strictEqual((await get("/products?q=%20%20&theme=%20%20")).response.status, 200);
  });

  it("filters by Category independently from LEGO theme", async () => {
    const suffix = randomUUID();
    await makeListing({ setNumber: `VEHICLE-SC-${suffix}`, title: "Speed Champions Vehicle", theme: "Speed Champions", category: "VEHICLES", originalPrice: 20 });
    await makeListing({ setNumber: `VEHICLE-TECH-${suffix}`, title: "Technic Vehicle", theme: "Technic", category: "VEHICLES", originalPrice: 20 });
    await makeListing({ setNumber: `CITY-SC-${suffix}`, title: "Speed Champions City", theme: "Speed Champions", category: "CITY", originalPrice: 20 });

    const vehiclesCategory = await prisma.category.findUniqueOrThrow({ where: { name: "Vehicles" } });
    const vehicles = await get(`/products?categoryId=${vehiclesCategory.id}&q=${suffix}`);
    assert.deepStrictEqual(vehicles.body.items.map((item: any) => item.setNumber).sort(), [`VEHICLE-SC-${suffix}`, `VEHICLE-TECH-${suffix}`].sort());
    assert.ok(vehicles.body.items.every((item: any) => item.category.id === vehiclesCategory.id));

    const combined = await get(`/products?categoryId=${vehiclesCategory.id}&theme=Technic&q=${suffix}`);
    assert.deepStrictEqual(combined.body.items.map((item: any) => item.setNumber), [`VEHICLE-TECH-${suffix}`]);
  });
});
