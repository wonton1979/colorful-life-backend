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

async function makeListing(data: { setNumber: string; title: string; theme: string; originalPrice: number; salePrice?: number; active?: boolean; createdAt?: Date }) {
  const product = await prisma.legoProduct.create({
    data: { setNumber: data.setNumber, title: data.title, theme: data.theme, ageRecommendation: "8+", pieceCount: 100 },
  });
  productIds.push(product.id);
  const listing = await prisma.productListing.create({
    data: { legoProductId: product.id, condition: "NEW", originalPrice: new Decimal(data.originalPrice), salePrice: data.salePrice === undefined ? null : new Decimal(data.salePrice), currentStock: 1, active: data.active ?? true, createdAt: data.createdAt },
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
  it("is public and returns the default paginated active catalogue", async () => {
    await makeListing({ setNumber: `CAT-${randomUUID()}`, title: "Active", theme: "City", originalPrice: 10 });
    await makeListing({ setNumber: `CAT-${randomUUID()}`, title: "Inactive", theme: "City", originalPrice: 20, active: false });
    const { response, body } = await get("/products");
    assert.strictEqual(response.status, 200);
    assert.ok(Array.isArray(body.items));
    assert.strictEqual(body.pagination.page, 1);
    assert.strictEqual(body.pagination.pageSize, 20);
    assert.ok(body.pagination.totalItems >= 1);
    assert.ok(body.items.some((item: any) => item.legoProduct.title === "Active"));
    assert.ok(!body.items.some((item: any) => item.legoProduct.title === "Inactive"));
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
    await makeListing({ setNumber: `P2-${suffix}`, title: "Set Two", theme: "Technic", originalPrice: 30, createdAt: new Date("2020-01-02") });
    await makeListing({ setNumber: `P3-${suffix}`, title: "Set Three", theme: "Technic", originalPrice: 40, salePrice: 35, createdAt: new Date("2020-01-03") });
    const filtered = await get(`/products?theme=TECHNIC&minPrice=20&maxPrice=35&page=1&pageSize=2`);
    assert.deepStrictEqual(filtered.body.pagination, { page: 1, pageSize: 2, totalItems: 3, totalPages: 2 });
    assert.deepStrictEqual(filtered.body.items.map((item: any) => item.legoProduct.setNumber), [`P3-${suffix}`, `P2-${suffix}`]);
    const second = await get(`/products?theme=TECHNIC&minPrice=20&maxPrice=35&page=2&pageSize=2`);
    assert.deepStrictEqual(second.body.items.map((item: any) => item.legoProduct.setNumber), [`P1-${suffix}`]);
    assert.strictEqual((await get(`/products?theme=TECHNIC&minPrice=20&maxPrice=35&page=3&pageSize=2`)).body.items.length, 0);
  });

  it("rejects invalid pagination and price parameters and ignores empty search filters", async () => {
    for (const query of ["page=0", "page=1.5", "pageSize=101", "pageSize=0", "minPrice=x", "maxPrice=-1", "minPrice=5&maxPrice=4"]) {
      assert.strictEqual((await get(`/products?${query}`)).response.status, 400, query);
    }
    assert.strictEqual((await get("/products?q=%20%20&theme=%20%20")).response.status, 200);
  });
});
