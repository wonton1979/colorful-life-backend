import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { prisma } from "../prisma/runtime.js";
import { config } from "../config/index.js";

// Test data tracking
const userIds: number[] = [];
const legoProductIds: number[] = [];
const listingIds: number[] = [];
const purchaseIds: number[] = [];
const purchaseDocIds: number[] = [];
const purchaseItemIds: number[] = [];
const inventoryMovementIds: number[] = [];

let server: any;
let baseUrl: string;
let userToken: string;
let userId: number;

before(() => {
  server = app.listen(0);
  const address = server.address() as any;
  baseUrl = `http://localhost:${address.port}`;
});

after(async () => {
  await prisma.$disconnect();
  server.close();
});

async function cleanup(): Promise<void> {
  if (inventoryMovementIds.length) {
    await prisma.inventoryMovement.deleteMany({ where: { id: { in: inventoryMovementIds } } });
  }
  if (purchaseItemIds.length) {
    await prisma.purchaseItem.deleteMany({ where: { id: { in: purchaseItemIds } } });
  }
  if (purchaseDocIds.length) {
    await prisma.purchaseDocument.deleteMany({ where: { id: { in: purchaseDocIds } } });
  }
  if (purchaseIds.length) {
    await prisma.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
  }
  if (listingIds.length) {
    await prisma.productListing.deleteMany({ where: { id: { in: listingIds } } });
  }
  if (legoProductIds.length) {
    await prisma.legoProduct.deleteMany({ where: { id: { in: legoProductIds } } });
  }
  if (userIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  inventoryMovementIds.length = 0;
  purchaseItemIds.length = 0;
  purchaseDocIds.length = 0;
  purchaseIds.length = 0;
  listingIds.length = 0;
  legoProductIds.length = 0;
  userIds.length = 0;
}

beforeEach(async () => {
  const user = await prisma.user.create({
    data: {
      email: `user-${randomUUID()}@example.com`,
      passwordHash: "test",
      emailVerified: true,
    },
  });
  userId = user.id;
  userIds.push(user.id);
  userToken = jwt.sign({ id: userId, role: "CUSTOMER" }, config.JWT_SECRET, { expiresIn: "1h" });
});

afterEach(async () => {
  await cleanup();
});

async function createPurchaseItem(quantity: number): Promise<{ purchaseItemId: number; listingId: number }> {
  const product = await prisma.legoProduct.create({
    data: {
      setNumber: randomUUID(),
      title: "Test Product",
      theme: "Test",
      ageRecommendation: "8+",
      pieceCount: 100,
    },
  });
  legoProductIds.push(product.id);
  const listing = await prisma.productListing.create({
    data: {
      legoProductId: product.id,
      condition: "NEW",
      originalPrice: 10.0,
      currentStock: 0,
    },
  });
  listingIds.push(listing.id);
  const purchase = await prisma.purchase.create({ data: { sourceOrderReference: randomUUID() } });
  const purchaseDoc = await prisma.purchaseDocument.create({
    data: {
      purchaseId: purchase.id,
      partNumber: 1,
      importHash: randomUUID(),
      importedByUserId: userId,
      originalGrossMerchandiseTotal: 0,
      finalTotalPaid: 0,
      shippingTotal: 0,
      discountTotal: 0,
    },
  });
  purchaseDocIds.push(purchaseDoc.id);
  const purchaseItem = await prisma.purchaseItem.create({
    data: {
      purchaseDocumentId: purchaseDoc.id,
      productListingId: listing.id,
      sourceDescription: "Test description",
      quantity,
      originalGrossUnitCost: 0,
      originalGrossLineTotal: 0,
      finalLineCost: 0,
      finalUnitCost: 0,
    },
  });
  purchaseItemIds.push(purchaseItem.id);
  return { purchaseItemId: purchaseItem.id, listingId: listing.id };
}

describe("POST /purchase-items/:id/receive", () => {
  it("authenticated successful receive returns 200 with result", async () => {
    const { purchaseItemId, listingId } = await createPurchaseItem(5);
    const res = await fetch(`${baseUrl}/purchase-items/${purchaseItemId}/receive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert(body.purchaseItem, "purchaseItem missing in response");
    assert(body.listing, "listing missing in response");
    assert(body.movement, "movement missing in response");
    assert.strictEqual(body.purchaseItem.id, purchaseItemId);
    assert.strictEqual(body.listing.id, listingId);
    assert.strictEqual(body.movement.type, "PURCHASE_IN");
    assert.strictEqual(body.movement.quantityChange, 5);
    assert.strictEqual(body.movement.performedByUserId, userId);
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listingId } });
    assert(listingAfter, "listing after should exist");
    assert.strictEqual(listingAfter.currentStock, 5);
    const purchaseItemAfter = await prisma.purchaseItem.findUnique({ where: { id: purchaseItemId } });
    assert(purchaseItemAfter?.receivedAt instanceof Date, "PurchaseItem receivedAt should be set in DB");
    assert(body.purchaseItem.receivedAt, "response missing receivedAt");
    const dbTime = new Date(purchaseItemAfter.receivedAt!).toISOString();
    const respTime = new Date(body.purchaseItem.receivedAt).toISOString();
    assert.strictEqual(dbTime, respTime, "DB and response receivedAt should match");
    inventoryMovementIds.push(body.movement.id);
  });

  it("unauthenticated request is rejected", async () => {
    const res = await fetch(`${baseUrl}/purchase-items/1/receive`, { method: "POST" });
    assert.strictEqual(res.status, 401);
  });

  it("invalid purchase item id returns 400", async () => {
    const res = await fetch(`${baseUrl}/purchase-items/abc/receive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res.status, 400);
  });

  it("non-existent purchase item returns 404", async () => {
    const res = await fetch(`${baseUrl}/purchase-items/999999999/receive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res.status, 404);
  });

  it("unmatched purchase item (missing listing) returns 400", async () => {
    const product = await prisma.legoProduct.create({
      data: {
        setNumber: randomUUID(),
        title: "Test Product",
        theme: "Test",
        ageRecommendation: "8+",
        pieceCount: 100,
      },
    });
    legoProductIds.push(product.id);
    const purchase = await prisma.purchase.create({ data: { sourceOrderReference: randomUUID() } });
    purchaseIds.push(purchase.id);
  const purchaseDoc = await prisma.purchaseDocument.create({
    data: {
      purchaseId: purchase.id,
      partNumber: 1,
      importHash: randomUUID(),
      importedByUserId: userId,
      originalGrossMerchandiseTotal: 0,
      finalTotalPaid: 0,
      shippingTotal: 0,
      discountTotal: 0,
    },
  });
    purchaseDocIds.push(purchaseDoc.id);
    const purchaseItem = await prisma.purchaseItem.create({
      data: {
        purchaseDocumentId: purchaseDoc.id,
        sourceDescription: "Test description",
        quantity: 3,
        originalGrossUnitCost: 0,
        originalGrossLineTotal: 0,
        finalLineCost: 0,
        finalUnitCost: 0,
      },
    });
    purchaseItemIds.push(purchaseItem.id);
    const res = await fetch(`${baseUrl}/purchase-items/${purchaseItem.id}/receive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res.status, 400);
  });

  it("duplicate receive returns 409", async () => {
    const { purchaseItemId, listingId } = await createPurchaseItem(2);
    const listingBefore = await prisma.productListing.findUnique({ where: { id: listingId } });
    assert(listingBefore, "listing should exist before receive");
    const stockBefore = listingBefore.currentStock;
    const purchaseItemBefore = await prisma.purchaseItem.findUnique({ where: { id: purchaseItemId } });
    assert(purchaseItemBefore?.receivedAt === null, "purchaseItem should not be received yet");
    // First receive
    const res1 = await fetch(`${baseUrl}/purchase-items/${purchaseItemId}/receive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res1.status, 200);
    const body1 = await res1.json();
    inventoryMovementIds.push(body1.movement.id);
    const purchaseItemAfterFirst = await prisma.purchaseItem.findUnique({ where: { id: purchaseItemId } });
    assert(purchaseItemAfterFirst?.receivedAt instanceof Date, "purchaseItem should have receivedAt set after first receive");
    const originalReceivedAt = purchaseItemAfterFirst?.receivedAt;
    // Second receive
    const res2 = await fetch(`${baseUrl}/purchase-items/${purchaseItemId}/receive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res2.status, 409);
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listingId } });
    assert(listingAfter, "listing should still exist after duplicate");
    assert.strictEqual(listingAfter.currentStock, stockBefore + 2, "stock should have increased only once");
    const movements = await prisma.inventoryMovement.findMany({ where: { listingId } });
    assert.strictEqual(movements.length, 1, "only one movement should exist after duplicate attempt");
    const purchaseItemAfter = await prisma.purchaseItem.findUnique({ where: { id: purchaseItemId } });
    assert(purchaseItemAfter?.receivedAt instanceof Date, "purchaseItem should have receivedAt set after duplicate attempt");
    const receivedAtAfter = purchaseItemAfter?.receivedAt;
    assert.strictEqual(receivedAtAfter?.toISOString(), originalReceivedAt?.toISOString(), "receivedAt should remain unchanged after duplicate attempt");
  });

  it("another user's purchase item returns controlled 404", async () => {
    const otherUser = await prisma.user.create({
      data: {
        email: `other-${randomUUID()}@example.com`,
        passwordHash: "test",
      },
    });
    userIds.push(otherUser.id);
    const product = await prisma.legoProduct.create({
      data: {
        setNumber: randomUUID(),
        title: "Test Product",
        theme: "Test",
        ageRecommendation: "8+",
        pieceCount: 100,
      },
    });
    legoProductIds.push(product.id);
    const purchase = await prisma.purchase.create({ data: { sourceOrderReference: randomUUID() } });
    purchaseIds.push(purchase.id);
    const purchaseDoc = await prisma.purchaseDocument.create({
      data: {
        purchaseId: purchase.id,
        partNumber: 1,
        importHash: randomUUID(),
        importedByUserId: otherUser.id,
        originalGrossMerchandiseTotal: 0,
        finalTotalPaid: 0,
        shippingTotal: 0,
        discountTotal: 0,
      },
    });
    purchaseDocIds.push(purchaseDoc.id);
    const listing = await prisma.productListing.create({
      data: {
        legoProductId: product.id,
        condition: "NEW",
        originalPrice: 10.0,
        currentStock: 0,
      },
    });
    listingIds.push(listing.id);
    const purchaseItem = await prisma.purchaseItem.create({
      data: {
        purchaseDocumentId: purchaseDoc.id,
        productListingId: listing.id,
        sourceDescription: "Test description",
        quantity: 1,
        originalGrossUnitCost: 0,
        originalGrossLineTotal: 0,
        finalLineCost: 0,
        finalUnitCost: 0,
      },
    });
    purchaseItemIds.push(purchaseItem.id);
    const res = await fetch(`${baseUrl}/purchase-items/${purchaseItem.id}/receive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res.status, 404);
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listing.id } });
    assert.strictEqual(listingAfter?.currentStock, 0, "listing stock should remain unchanged");
    const movements = await prisma.inventoryMovement.findMany({ where: { listingId: listing.id } });
    assert.strictEqual(movements.length, 0, "no movement should exist for unauthorized receive");
    const purchaseItemAfter = await prisma.purchaseItem.findUnique({ where: { id: purchaseItem.id } });
    assert.strictEqual(purchaseItemAfter?.receivedAt, null, "purchaseItem should remain unreceived");
  });
});
