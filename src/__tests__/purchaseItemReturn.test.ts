import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import { prisma } from "../prisma/runtime.js";
import {
  returnPurchaseItem,
  PurchaseItemNotFoundError,
  PurchaseItemNotReceivedError,
  PurchaseItemAlreadyReturnedError,
  ProductListingMissingError,
  InsufficientStockError,
  InvalidQuantityError,
  type PurchaseItemReturnResult,
} from "../domain/purchases/purchaseItemReturn.js";
import { receivePurchaseItem } from "../domain/purchases/purchaseItemReceiving.js";

// ---------------------------------------------------------------------------
// Test data tracking
// ---------------------------------------------------------------------------

let userId: number;

const userIds: number[] = [];
const productIds: number[] = [];
const listingIds: number[] = [];
const purchaseIds: number[] = [];
const purchaseDocIds: number[] = [];
const purchaseItemIds: number[] = [];
const inventoryMovementIds: number[] = [];

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

// ---------------------------------------------------------------------------
// Helper functions to create fixtures
// ---------------------------------------------------------------------------

async function createPurchaseItem({
  quantity,
  linkedToListing = true,
  receivedAt = false,
  returnedAt = false,
  listingStock = 10,
}: {
  quantity: number;
  linkedToListing?: boolean;
  receivedAt?: boolean;
  returnedAt?: boolean;
  listingStock?: number;
}) {
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
      currentStock: listingStock,
    },
  });
  listingIds.push(listing.id);

  const purchase = await prisma.purchase.create({
    data: {
      sourceOrderReference: `SO-${randomUUID()}`,
    },
  });
  purchaseIds.push(purchase.id);

  const purchaseDoc = await prisma.purchaseDocument.create({
    data: {
      purchaseId: purchase.id,
      partNumber: 1,
      importHash: randomUUID(),
      importedByUserId: userId,
      originalGrossMerchandiseTotal: 0,
      shippingTotal: 0,
      discountTotal: 0,
      finalTotalPaid: 0,
    },
  });
  purchaseDocIds.push(purchaseDoc.id);

  const purchaseItem = await prisma.purchaseItem.create({
    data: {
      purchaseDocumentId: purchaseDoc.id,
      productListingId: linkedToListing ? listing.id : null,
      sourceDescription: "Test Item",
      quantity,
      originalGrossUnitCost: 1.0,
      originalGrossLineTotal: 1.0,
      finalLineCost: 1.0,
      finalUnitCost: 1.0,
      receivedAt: receivedAt ? new Date() : null,
      returnedAt: returnedAt ? new Date() : null,
    },
  });
  purchaseItemIds.push(purchaseItem.id);
  return {
    purchaseItemId: purchaseItem.id,
    listingId: listing.id,
    listingStock,
  };
}

describe("returnPurchaseItem integration tests", () => {
  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        email: `user-${randomUUID()}@example.com`,
        passwordHash: "test",
      },
    });
    userId = user.id;
    userIds.push(user.id);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("successfully returns a received purchase item", async () => {
    const { purchaseItemId, listingId } = await createPurchaseItem({ quantity: 5, receivedAt: true });
    const listingBefore = await prisma.productListing.findUnique({ where: { id: listingId } });
    const startingStock = listingBefore!.currentStock;
    const result = await returnPurchaseItem(userId, purchaseItemId);
    inventoryMovementIds.push(result.inventoryMovement.id);
    assert.strictEqual(result.purchaseItem.id, purchaseItemId);
    assert(result.purchaseItem.returnedAt instanceof Date, "returnedAt should be a Date");
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listingId } });
    assert.strictEqual(listingAfter!.currentStock, startingStock - 5, "stock should decrement");
    assert.strictEqual(result.inventoryMovement.type, "PURCHASE_RETURN_OUT");
    assert.strictEqual(result.inventoryMovement.quantityChange, -5);
    assert.strictEqual(result.inventoryMovement.performedByUserId, userId);
  });

  it("rejects return on an unreceived item", async () => {
    const { purchaseItemId, listingId } = await createPurchaseItem({ quantity: 3 });
    const listingBefore = await prisma.productListing.findUnique({ where: { id: listingId } });
    const stockBefore = listingBefore!.currentStock;
    await assert.rejects(
      () => returnPurchaseItem(userId, purchaseItemId),
      (err) => err instanceof PurchaseItemNotReceivedError,
    );
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listingId } });
    assert.strictEqual(listingAfter!.currentStock, stockBefore, "stock should remain unchanged");
    const itemAfter = await prisma.purchaseItem.findUnique({ where: { id: purchaseItemId } });
    assert.strictEqual(itemAfter!.returnedAt, null, "returnedAt should remain null");
    const movements = await prisma.inventoryMovement.findMany({ where: { listingId } });
    assert.strictEqual(movements.length, 0, "no movement should be created");
  });

  it("rejects duplicate return", async () => {
    const { purchaseItemId, listingId } = await createPurchaseItem({ quantity: 2, receivedAt: true });
    const result1 = await returnPurchaseItem(userId, purchaseItemId);
    inventoryMovementIds.push(result1.inventoryMovement.id);
    const listingAfterFirst = await prisma.productListing.findUnique({ where: { id: listingId } });
    const stockAfterFirst = listingAfterFirst!.currentStock;
    const returnedAtFirst = result1.purchaseItem.returnedAt as Date;
    await assert.rejects(
      () => returnPurchaseItem(userId, purchaseItemId),
      (err) => err instanceof PurchaseItemAlreadyReturnedError,
    );
    const listingAfterSecond = await prisma.productListing.findUnique({ where: { id: listingId } });
    assert.strictEqual(listingAfterSecond!.currentStock, stockAfterFirst, "stock should remain unchanged after duplicate");
    const itemAfter = await prisma.purchaseItem.findUnique({ where: { id: purchaseItemId } });
    assert.strictEqual(itemAfter!.returnedAt!.getTime(), returnedAtFirst.getTime(), "returnedAt should not change after duplicate");
    const movements = await prisma.inventoryMovement.findMany({ where: { listingId } });
    assert.strictEqual(movements.length, 1, "only one movement should exist");
  });

  it("concurrent returns on same item: one succeeds, one fails", async () => {
    const { purchaseItemId, listingId } = await createPurchaseItem({ quantity: 4, receivedAt: true });
    const listingBefore = await prisma.productListing.findUnique({ where: { id: listingId } });
    const startingStock = listingBefore!.currentStock;
    const results = await Promise.allSettled([
      returnPurchaseItem(userId, purchaseItemId),
      returnPurchaseItem(userId, purchaseItemId),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<PurchaseItemReturnResult>[];
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    assert.strictEqual(fulfilled.length, 1, "one should succeed");
    assert.strictEqual(rejected.length, 1, "one should fail");
    assert(rejected[0].reason instanceof PurchaseItemAlreadyReturnedError);
    inventoryMovementIds.push(fulfilled[0].value.inventoryMovement.id);
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listingId } });
    assert.strictEqual(listingAfter!.currentStock, startingStock - 4, "stock should decrement once");
    const itemAfter = await prisma.purchaseItem.findUnique({ where: { id: purchaseItemId } });
    assert(itemAfter!.returnedAt instanceof Date, "returnedAt should be populated");
    const movements = await prisma.inventoryMovement.findMany({ where: { listingId } });
    assert.strictEqual(movements.length, 1, "exactly one movement should exist");
  });

  it("concurrent returns on different items sharing a listing: stock enforced", async () => {
    // Create listing with 5 stock
    const product = await prisma.legoProduct.create({
      data: {
        setNumber: randomUUID(),
        title: "Shared Listing Product",
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
        currentStock: 5,
      },
    });
    listingIds.push(listing.id);
    const purchase = await prisma.purchase.create({ data: { sourceOrderReference: `SO-${randomUUID()}` } });
    purchaseIds.push(purchase.id);
    const purchaseDoc = await prisma.purchaseDocument.create({
      data: {
        purchaseId: purchase.id,
        partNumber: 1,
        importHash: randomUUID(),
        importedByUserId: userId,
        originalGrossMerchandiseTotal: 0,
        shippingTotal: 0,
        discountTotal: 0,
        finalTotalPaid: 0,
      },
    });
    purchaseDocIds.push(purchaseDoc.id);
    const itemA = await prisma.purchaseItem.create({
      data: {
        purchaseDocumentId: purchaseDoc.id,
        productListingId: listing.id,
        sourceDescription: "Item A",
        quantity: 3,
        originalGrossUnitCost: 1.0,
        originalGrossLineTotal: 1.0,
        finalLineCost: 1.0,
        finalUnitCost: 1.0,
        receivedAt: new Date(),
      },
    });
    purchaseItemIds.push(itemA.id);
    const itemB = await prisma.purchaseItem.create({
      data: {
        purchaseDocumentId: purchaseDoc.id,
        productListingId: listing.id,
        sourceDescription: "Item B",
        quantity: 3,
        originalGrossUnitCost: 1.0,
        originalGrossLineTotal: 1.0,
        finalLineCost: 1.0,
        finalUnitCost: 1.0,
        receivedAt: new Date(),
      },
    });
    purchaseItemIds.push(itemB.id);
    const results = await Promise.allSettled([
      returnPurchaseItem(userId, itemA.id),
      returnPurchaseItem(userId, itemB.id),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<PurchaseItemReturnResult>[];
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    assert.strictEqual(fulfilled.length, 1, "only one should succeed");
    assert.strictEqual(rejected.length, 1, "only one should fail");
    assert(rejected[0].reason instanceof InsufficientStockError);
    inventoryMovementIds.push(fulfilled[0].value.inventoryMovement.id);
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listing.id } });
    assert.strictEqual(listingAfter!.currentStock, 2, "final stock should be 2");
    const winnerId = fulfilled[0].value.purchaseItem.id;
    const loserId = winnerId === itemA.id ? itemB.id : itemA.id;
    const winnerItem = await prisma.purchaseItem.findUnique({ where: { id: winnerId } });
    const loserItem = await prisma.purchaseItem.findUnique({ where: { id: loserId } });
    assert(winnerItem!.returnedAt instanceof Date, "winner should have returnedAt");
    assert.strictEqual(loserItem!.returnedAt, null, "loser should have returnedAt null");
    const movements = await prisma.inventoryMovement.findMany({ where: { listingId: listing.id } });
    assert.strictEqual(movements.length, 1, "exactly one movement should exist");
  });

  it("rejects return on item belonging to another user", async () => {
    const otherUser = await prisma.user.create({
      data: { email: `other-${randomUUID()}@example.com`, passwordHash: "test" },
    });
    userIds.push(otherUser.id);
    const { purchaseItemId, listingId } = await createPurchaseItem({ quantity: 2, receivedAt: true });
    await assert.rejects(
      () => returnPurchaseItem(otherUser.id, purchaseItemId),
      (err) => err instanceof PurchaseItemNotFoundError,
    );
    const itemAfter = await prisma.purchaseItem.findUnique({ where: { id: purchaseItemId } });
    assert.strictEqual(itemAfter!.returnedAt, null, "returnedAt should remain null");
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listingId } });
    assert.strictEqual(listingAfter!.currentStock, 10, "stock should remain unchanged");
    const movements = await prisma.inventoryMovement.findMany({ where: { listingId } });
    assert.strictEqual(movements.length, 0, "no movement should be created");
  });

  it("rejects return when product listing is missing", async () => {
    const { purchaseItemId, listingId } = await createPurchaseItem({ quantity: 3, linkedToListing: false, receivedAt: true });
    await assert.rejects(
      () => returnPurchaseItem(userId, purchaseItemId),
      (err) => err instanceof ProductListingMissingError,
    );
    const itemAfter = await prisma.purchaseItem.findUnique({ where: { id: purchaseItemId } });
    assert.strictEqual(itemAfter!.returnedAt, null, "returnedAt should remain null");
    const movements = await prisma.inventoryMovement.findMany({ where: { listingId } });
    assert.strictEqual(movements.length, 0, "no movement should be created");
  });

  it("rejects return with invalid quantity", async () => {
    const { purchaseItemId, listingId } = await createPurchaseItem({ quantity: 0, receivedAt: true });
    await assert.rejects(
      () => returnPurchaseItem(userId, purchaseItemId),
      (err) => err instanceof InvalidQuantityError,
    );
    const itemAfter = await prisma.purchaseItem.findUnique({ where: { id: purchaseItemId } });
    assert.strictEqual(itemAfter!.returnedAt, null, "returnedAt should remain null");
    const movements = await prisma.inventoryMovement.findMany({ where: { listingId } });
    assert.strictEqual(movements.length, 0, "no movement should be created");
  });

  it("rejects return with insufficient stock (non-concurrent)", async () => {
    const { purchaseItemId, listingId } = await createPurchaseItem({ quantity: 3, listingStock: 2, receivedAt: true });
    await assert.rejects(
      () => returnPurchaseItem(userId, purchaseItemId),
      (err) => err instanceof InsufficientStockError,
    );
    const itemAfter = await prisma.purchaseItem.findUnique({ where: { id: purchaseItemId } });
    assert.strictEqual(itemAfter!.returnedAt, null, "returnedAt should remain null");
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listingId } });
    assert.strictEqual(listingAfter!.currentStock, 2, "stock should remain unchanged");
    const movements = await prisma.inventoryMovement.findMany({ where: { listingId } });
    assert.strictEqual(movements.length, 0, "no movement should be created");
  });
});
