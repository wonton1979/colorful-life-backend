import { strict as assert } from "node:assert";
import { after, afterEach, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { createApp } from "../app.js";
import { config } from "../config/index.js";
import { prisma } from "../prisma/runtime.js";
import type { ImageStorage, ImageUploadInput, StoredImage } from "../infrastructure/imageStorage/imageStorage.js";

class FakeArtworkStorage implements ImageStorage {
  uploads: ImageUploadInput[] = [];
  deletions: string[] = [];
  failUpload = false;
  async upload(input: ImageUploadInput): Promise<StoredImage> {
    if (this.failUpload) throw new Error("fake upload failed");
    this.uploads.push(input);
    const publicId = `colorful-life/catalogue-artwork/${input.publicId}`;
    return { publicId, secureUrl: `https://cdn.example/${publicId}.jpg` };
  }
  async delete(publicId: string) { this.deletions.push(publicId); }
}

const ids = { users: [] as number[], products: [] as number[], listings: [] as number[] };
const artworkStorage = new FakeArtworkStorage();
let server: Server;
let url: string;

before(async () => {
  server = createApp(undefined, artworkStorage).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  url = `http://localhost:${address.port}`;
});

afterEach(async () => {
  if (ids.listings.length) await prisma.productListing.deleteMany({ where: { id: { in: ids.listings } } });
  if (ids.products.length) await prisma.legoProduct.deleteMany({ where: { id: { in: ids.products } } });
  if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  ids.users.length = ids.products.length = ids.listings.length = 0;
  artworkStorage.uploads.length = artworkStorage.deletions.length = 0;
  artworkStorage.failUpload = false;
});

after(async () => { await prisma.$disconnect(); server.close(); });

async function user(role: "ADMIN" | "CUSTOMER") {
  const created = await prisma.user.create({ data: { email: `${role}-${randomUUID()}@example.com`, passwordHash: "test", role } });
  ids.users.push(created.id);
  return jwt.sign({ id: created.id, role }, config.JWT_SECRET, { expiresIn: "1h" });
}

async function listing(category: "VEHICLES" | "CITY" = "VEHICLES", theme = "Technic") {
  const categoryRecord = await prisma.category.findUniqueOrThrow({ where: { name: category === "VEHICLES" ? "Vehicles" : "City" } });
  const product = await prisma.legoProduct.create({ data: { setNumber: `PRESENTATION-${randomUUID()}`, title: "Presentation Product", theme, ageRecommendation: "8+", pieceCount: 100, categoryId: categoryRecord.id } });
  ids.products.push(product.id);
  const created = await prisma.productListing.create({ data: { legoProductId: product.id, condition: "NEW", originalPrice: 10, currentStock: 2 } });
  ids.listings.push(created.id);
  return created;
}

function request(path: string, token?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${url}${path}`, { ...init, headers });
}

function artworkForm() {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9])], { type: "image/jpeg" }), "artwork.jpg");
  return form;
}

describe("catalogue presentation administration", () => {
  it("keeps feature selection explicit, atomic, category-scoped, and admin-only", async () => {
    const admin = await user("ADMIN");
    const customer = await user("CUSTOMER");
    const first = await listing("VEHICLES", "Speed Champions");
    const second = await listing("VEHICLES", "Technic");
    const otherCategory = await listing("CITY", "City");

    assert.equal(first.isFeatureProduct, false);
    assert.equal((await request(`/products/${first.id}/feature`, undefined, { method: "PATCH" })).status, 401);
    assert.equal((await request(`/products/${first.id}/feature`, customer, { method: "PATCH" })).status, 403);
    assert.equal((await request("/products/999999/feature", admin, { method: "PATCH" })).status, 404);

    assert.equal((await request(`/products/${first.id}/feature`, admin, { method: "PATCH" })).status, 200);
    assert.equal((await request(`/products/${second.id}/feature`, admin, { method: "PATCH" })).status, 200);
    assert.equal((await prisma.productListing.findUnique({ where: { id: first.id } }))?.isFeatureProduct, false);
    assert.equal((await prisma.productListing.findUnique({ where: { id: second.id } }))?.isFeatureProduct, true);
    assert.equal((await request(`/products/${second.id}/feature`, admin, { method: "PATCH" })).status, 200);
    assert.equal((await prisma.productListing.findUnique({ where: { id: otherCategory.id } }))?.isFeatureProduct, false);

    const third = await listing("CITY", "Icons");
    const fourth = await listing("CITY", "Creator");
    await prisma.productListing.update({ where: { id: third.id }, data: { isFeatureProduct: true } });
    await assert.rejects(
      prisma.productListing.update({ where: { id: fourth.id }, data: { isFeatureProduct: true } }),
      (error: any) => error.code === "P2002",
    );
  });

  it("uploads, replaces, exposes, and removes artwork without touching ListingImages", async () => {
    const admin = await user("ADMIN");
    const created = await listing();
    const image = await prisma.listingImage.create({ data: { listingId: created.id, url: "https://cdn.example/product.jpg", publicId: `colorful-life/products/${created.id}-image`, sortOrder: 0, altText: "product" } });

    const initialRead = await (await request(`/products/${created.id}`)).json();
    assert.equal(initialRead.catalogueArtworkUrl, null);
    assert.equal(initialRead.catalogueArtworkPublicId, null);
    assert.equal(initialRead.isFeatureProduct, false);

    const firstUpload = await request(`/products/${created.id}/catalogue-artwork`, admin, { method: "PUT", body: artworkForm() });
    assert.equal(firstUpload.status, 200);
    const firstArtwork = (await firstUpload.json()).catalogueArtwork;
    assert.ok(firstArtwork.publicId.startsWith(`colorful-life/catalogue-artwork/${created.id}-`));
    assert.equal((await prisma.listingImage.findUnique({ where: { id: image.id } }))?.publicId, image.publicId);

    const secondUpload = await request(`/products/${created.id}/catalogue-artwork`, admin, { method: "PUT", body: artworkForm() });
    assert.equal(secondUpload.status, 200);
    const secondArtwork = (await secondUpload.json()).catalogueArtwork;
    assert.notEqual(secondArtwork.publicId, firstArtwork.publicId);
    assert.deepEqual(artworkStorage.deletions, [firstArtwork.publicId]);

    const vehicles = await prisma.category.findUniqueOrThrow({ where: { name: "Vehicles" } });
    const catalogue = await (await request(`/products?categoryId=${vehicles.id}&theme=Technic`)).json();
    const item = catalogue.items.find((entry: any) => entry.id === created.id);
    assert.equal(item.catalogueArtworkUrl, secondArtwork.url);
    assert.equal(item.catalogueArtworkPublicId, secondArtwork.publicId);
    assert.deepEqual(item.listingImages.map((entry: any) => entry.id), [image.id]);

    assert.equal((await request(`/products/${created.id}/catalogue-artwork`, admin, { method: "DELETE" })).status, 204);
    const removed = await prisma.productListing.findUnique({ where: { id: created.id } });
    assert.equal(removed?.catalogueArtworkUrl, null);
    assert.equal(removed?.catalogueArtworkPublicId, null);
    assert.deepEqual(artworkStorage.deletions, [firstArtwork.publicId, secondArtwork.publicId]);
    assert.equal((await request(`/products/${created.id}/catalogue-artwork`, undefined, { method: "DELETE" })).status, 401);
  });

  it("rejects invalid artwork and leaves the database unchanged when storage fails", async () => {
    const admin = await user("ADMIN");
    const created = await listing();
    const invalid = new FormData();
    invalid.append("file", new Blob(["not an image"], { type: "image/jpeg" }), "bad.jpg");
    assert.equal((await request(`/products/${created.id}/catalogue-artwork`, admin, { method: "PUT", body: invalid })).status, 400);
    artworkStorage.failUpload = true;
    assert.equal((await request(`/products/${created.id}/catalogue-artwork`, admin, { method: "PUT", body: artworkForm() })).status, 500);
    const unchanged = await prisma.productListing.findUnique({ where: { id: created.id } });
    assert.equal(unchanged?.catalogueArtworkUrl, null);
    assert.equal(unchanged?.catalogueArtworkPublicId, null);
  });
});
