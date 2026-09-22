import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { createApp } from "../app.js";
import { config } from "../config/index.js";
import { prisma } from "../prisma/runtime.js";
import type { ImageStorage, ImageUploadInput, StoredImage } from "../infrastructure/imageStorage/imageStorage.js";

class CategoryStorage implements ImageStorage {
  uploads: ImageUploadInput[] = [];
  deletions: string[] = [];
  async upload(input: ImageUploadInput): Promise<StoredImage> {
    this.uploads.push(input);
    const publicId = `colorful-life/category-artwork/${input.publicId}`;
    return { publicId, secureUrl: `https://cdn.example/${publicId}.jpg` };
  }
  async delete(publicId: string) { this.deletions.push(publicId); }
}
const storage = new CategoryStorage();
const users: number[] = [];
const categories: number[] = [];
let server: Server;
let url: string;

before(async () => {
  server = createApp(undefined, undefined, storage).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  url = `http://localhost:${address.port}`;
});
afterEach(async () => {
  if (categories.length) await prisma.category.deleteMany({ where: { id: { in: categories } } });
  if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
  categories.length = users.length = 0; storage.uploads.length = storage.deletions.length = 0;
});
after(async () => { await prisma.$disconnect(); server.close(); });

async function admin(role: "ADMIN" | "CUSTOMER" = "ADMIN") {
  const user = await prisma.user.create({ data: { email: `category-management-${role}-${randomUUID()}@example.com`, passwordHash: "test", role } });
  users.push(user.id);
  return jwt.sign({ id: user.id, role }, config.JWT_SECRET, { expiresIn: "1h" });
}
async function category() {
  const value = await prisma.category.create({ data: { name: `Managed ${randomUUID()}`, subtitle: "Initial subtitle", description: "Initial description" } });
  categories.push(value.id);
  return value;
}
function request(path: string, token?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers); if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  return fetch(`${url}${path}`, { ...init, headers });
}
function artworkForm(seed = 1) {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0, seed, 0, 0, 0, 0xff, 0xd9])], { type: "image/jpeg" }), "artwork.jpg");
  return form;
}

describe("category management administration", () => {
  it("protects Admin reads and updates text metadata with authoritative data", async () => {
    const value = await category(); const token = await admin();
    assert.equal((await request("/admin/categories")).status, 401);
    assert.equal((await request("/admin/categories", await admin("CUSTOMER"))).status, 403);
    const list = await (await request("/admin/categories", token)).json();
    assert.ok(list.some((entry: { id: number }) => entry.id === value.id));
    const response = await request(`/admin/categories/${value.id}`, token, { method: "PATCH", body: JSON.stringify({ name: ` Renamed ${value.id} `, subtitle: " New subtitle ", description: "" }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: value.id, name: `Renamed ${value.id}`, subtitle: "New subtitle", description: null, imageUrl: null, imagePublicId: null });
  });
  it("rejects invalid and missing IDs, invalid input, and duplicate names", async () => {
    const value = await category(); const token = await admin(); const existing = await prisma.category.findFirstOrThrow({ where: { id: { not: value.id } } });
    assert.equal((await request("/admin/categories/0", token, { method: "PATCH", body: JSON.stringify({ name: "x", subtitle: null, description: null }) })).status, 404);
    assert.equal((await request("/admin/categories/999999999", token, { method: "PATCH", body: JSON.stringify({ name: "x", subtitle: null, description: null }) })).status, 404);
    assert.equal((await request(`/admin/categories/${value.id}`, token, { method: "PATCH", body: JSON.stringify({ name: " ", subtitle: null, description: null }) })).status, 400);
    assert.equal((await request(`/admin/categories/${value.id}`, token, { method: "PATCH", body: JSON.stringify({ name: existing.name, subtitle: null, description: null }) })).status, 409);
  });
  it("uploads, replaces, and removes artwork while keeping both fields together", async () => {
    const value = await category(); const token = await admin();
    const first = await (await request(`/admin/categories/${value.id}/artwork`, token, { method: "PUT", body: artworkForm(1) })).json();
    assert.equal(first.imagePublicId, storage.uploads[0] && `colorful-life/category-artwork/${storage.uploads[0].publicId}`);
    const second = await (await request(`/admin/categories/${value.id}/artwork`, token, { method: "PUT", body: artworkForm(2) })).json();
    assert.notEqual(second.imagePublicId, first.imagePublicId);
    assert.deepEqual(storage.deletions, [first.imagePublicId]);
    const removed = await (await request(`/admin/categories/${value.id}/artwork`, token, { method: "DELETE" })).json();
    assert.equal(removed.imageUrl, null); assert.equal(removed.imagePublicId, null);
    assert.deepEqual(storage.deletions, [first.imagePublicId, second.imagePublicId]);
  });
  it("returns 404 for missing artwork targets and leaves state unchanged on upload failure", async () => {
    const token = await admin();
    assert.equal((await request("/admin/categories/999999999/artwork", token, { method: "PUT", body: artworkForm() })).status, 404);
  });
});
