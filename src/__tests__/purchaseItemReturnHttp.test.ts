import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { prisma } from "../prisma/runtime.js";
import { config } from "../config/index.js";

// Test data tracking
const userIds: number[] = [];
const productIds: number[] = [];
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
    // Delete inventory movements that belong to listings created by this test suite
    if (listingIds.length) {
      await prisma.inventoryMovement.deleteMany({
        where: {
          listingId: { in: listingIds },
        },
      });
    }
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
  if (productIds.length) {
    await prisma.legoProduct.deleteMany({ where: { id: { in: productIds } } });
  }
  if (userIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  inventoryMovementIds.length = 0;
  purchaseItemIds.length = 0;
  purchaseDocIds.length = 0;
  purchaseIds.length = 0;
  listingIds.length = 0;
  productIds.length = 0;
  userIds.length = 0;
}

beforeEach(async () => {
  const user = await prisma.user.create({
    data: {
      email: `user-${randomUUID()}@example.com`,
      passwordHash: "test",
    },
  });
  userId = user.id;
  userIds.push(user.id);
  userToken = jwt.sign({ id: userId, role: "CUSTOMER" }, config.JWT_SECRET, { expiresIn: "1h" });
});

afterEach(async () => {
  await cleanup();
});

async function createReturnedPurchaseItem(quantity: number): Promise<{ purchaseItemId: number; listingId: number; initialStock: number }> {
  const product = await prisma.legoProduct.create({
    data: {
      setNumber: randomUUID(),
      title: "Test Product",
      theme: "Test",
      ageRecommendation: "8+",
      pieceCount: 100,
    },
  });
  productIds.push(product.id);
  const listing = await prisma.productListing.create({
    data: {
      legoProductId: product.id,
      condition: "NEW",
      originalPrice: 10.0,
      currentStock: 10,
    },
  });
  listingIds.push(listing.id);
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
      productListingId: listing.id,
      sourceDescription: "Test description",
      quantity,
      originalGrossUnitCost: 0,
      originalGrossLineTotal: 0,
      finalLineCost: 0,
      finalUnitCost: 0,
      receivedAt: new Date(),
    },
  });
  purchaseItemIds.push(purchaseItem.id);
  return { purchaseItemId: purchaseItem.id, listingId: listing.id, initialStock: listing.currentStock };
}

describe("Purchase Item Return HTTP Layer", () => {
  it("successful return updates stock and returns movement", async () => {
    const { purchaseItemId, listingId, initialStock } = await createReturnedPurchaseItem(2);
    const res = await fetch(`${baseUrl}/purchase-items/${purchaseItemId}/return`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.purchaseItem.id, purchaseItemId);
    assert(json.purchaseItem.returnedAt);
    assert.strictEqual(json.productListing.id, listingId);
    assert.strictEqual(json.productListing.currentStock, initialStock - 2);
    assert.strictEqual(json.inventoryMovement.type, "PURCHASE_RETURN_OUT");
    assert.strictEqual(json.inventoryMovement.quantityChange, -2);
    assert.strictEqual(json.inventoryMovement.performedByUserId, userId);
    // Verify persistence
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listingId } });
    assert(listingAfter);
    assert.strictEqual(listingAfter.currentStock, initialStock - 2);
    const movementAfter = await prisma.inventoryMovement.findUnique({ where: { id: json.inventoryMovement.id } });
    assert(movementAfter);
    assert.strictEqual(movementAfter.type, "PURCHASE_RETURN_OUT");
    assert.strictEqual(movementAfter.quantityChange, -2);
    assert.strictEqual(movementAfter.performedByUserId, userId);
    const itemAfter = await prisma.purchaseItem.findUnique({ where: { id: purchaseItemId } });
    assert(itemAfter?.returnedAt instanceof Date);
  });

  it("invalid id returns 400", async () => {
    const res = await fetch(`${baseUrl}/purchase-items/abc/return`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res.status, 400);
  });

  it("unauthenticated request returns 401", async () => {
    const { purchaseItemId } = await createReturnedPurchaseItem(1);
    const res = await fetch(`${baseUrl}/purchase-items/${purchaseItemId}/return`, {
      method: "POST",
    });
    assert.strictEqual(res.status, 401);
  });

  it("non-existent purchase item returns 404", async () => {
    const res = await fetch(`${baseUrl}/purchase-items/9999999/return`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res.status, 404);
  });

  it("another user's purchase item return is controlled 404", async () => {
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
    productIds.push(product.id);
    const listing = await prisma.productListing.create({
      data: {
        legoProductId: product.id,
        condition: "NEW",
        originalPrice: 10.0,
        currentStock: 10,
      },
    });
    listingIds.push(listing.id);
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
        receivedAt: new Date(),
      },
    });
    purchaseItemIds.push(purchaseItem.id);
    const res = await fetch(`${baseUrl}/purchase-items/${purchaseItem.id}/return`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res.status, 404);
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listing.id } });
    assert.strictEqual(listingAfter?.currentStock, 10);
    const movementAfter = await prisma.inventoryMovement.findMany({ where: { listingId: listing.id } });
    assert.strictEqual(movementAfter.length, 0);
    const itemAfter = await prisma.purchaseItem.findUnique({ where: { id: purchaseItem.id } });
    assert(itemAfter?.returnedAt === null);
  });

  it("unreceived purchase item returns 400", async () => {
    const product = await prisma.legoProduct.create({
      data: {
        setNumber: randomUUID(),
        title: "Test Product",
        theme: "Test",
        ageRecommendation: "8+",
        pieceCount: 100,
      },
    });
    productIds.push(product.id);
    const listing = await prisma.productListing.create({
      data: {
        legoProductId: product.id,
        condition: "NEW",
        originalPrice: 10.0,
        currentStock: 10,
      },
    });
    listingIds.push(listing.id);
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
        productListingId: listing.id,
        sourceDescription: "Test description",
        quantity: 1,
        originalGrossUnitCost: 0,
        originalGrossLineTotal: 0,
        finalLineCost: 0,
        finalUnitCost: 0,
        // receivedAt is null
      },
    });
    purchaseItemIds.push(purchaseItem.id);
    const res = await fetch(`${baseUrl}/purchase-items/${purchaseItem.id}/return`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res.status, 400);
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listing.id } });
    assert.strictEqual(listingAfter?.currentStock, 10);
    const movementAfter = await prisma.inventoryMovement.findMany({ where: { listingId: listing.id } });
    assert.strictEqual(movementAfter.length, 0);
    const itemAfter = await prisma.purchaseItem.findUnique({ where: { id: purchaseItem.id } });
    assert(itemAfter?.returnedAt === null);
  });

  it("duplicate return yields 409 and single movement", async () => {
    const { purchaseItemId, listingId, initialStock } = await createReturnedPurchaseItem(1);
    const res1 = await fetch(`${baseUrl}/purchase-items/${purchaseItemId}/return`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res1.status, 200);
    const res2 = await fetch(`${baseUrl}/purchase-items/${purchaseItemId}/return`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res2.status, 409);
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listingId } });
    assert.strictEqual(listingAfter?.currentStock, initialStock - 1);
    const movements = await prisma.inventoryMovement.findMany({ where: { listingId } });
    assert.strictEqual(movements.length, 1);
    const movement = movements[0];
    assert.strictEqual(movement.type, "PURCHASE_RETURN_OUT");
    assert.strictEqual(movement.quantityChange, -1);
    const itemAfter = await prisma.purchaseItem.findUnique({ where: { id: purchaseItemId } });
    assert(itemAfter?.returnedAt instanceof Date);
  });

  it("insufficient stock returns 400 and no movement", async () => {
    const product = await prisma.legoProduct.create({
      data: {
        setNumber: randomUUID(),
        title: "Test Product",
        theme: "Test",
        ageRecommendation: "8+",
        pieceCount: 100,
      },
    });
    productIds.push(product.id);
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
        productListingId: listing.id,
        sourceDescription: "Test description",
        quantity: 1,
        originalGrossUnitCost: 0,
        originalGrossLineTotal: 0,
        finalLineCost: 0,
        finalUnitCost: 0,
        receivedAt: new Date(),
      },
    });
    purchaseItemIds.push(purchaseItem.id);
    const res = await fetch(`${baseUrl}/purchase-items/${purchaseItem.id}/return`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res.status, 400);
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listing.id } });
    assert.strictEqual(listingAfter?.currentStock, 0);
    const movements = await prisma.inventoryMovement.findMany({ where: { listingId: listing.id } });
    assert.strictEqual(movements.length, 0);
    const itemAfter = await prisma.purchaseItem.findUnique({ where: { id: purchaseItem.id } });
    assert(itemAfter?.returnedAt === null);
  });
});
