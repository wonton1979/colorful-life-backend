import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import { prisma } from "../prisma/runtime.js";
import {
  AlreadyReceivedError,
  InvalidQuantityError,
  ProductListingMissingError,
  PurchaseItemNotFoundError,
  receivePurchaseItem,
} from "../domain/purchases/purchaseItemReceiving.js";

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
    await prisma.inventoryMovement.deleteMany({
      where: { id: { in: inventoryMovementIds } },
    });
  }

  if (purchaseItemIds.length) {
    await prisma.purchaseItem.deleteMany({
      where: { id: { in: purchaseItemIds } },
    });
  }

  if (purchaseDocIds.length) {
    await prisma.purchaseDocument.deleteMany({
      where: { id: { in: purchaseDocIds } },
    });
  }

  if (purchaseIds.length) {
    await prisma.purchase.deleteMany({
      where: { id: { in: purchaseIds } },
    });
  }

  if (listingIds.length) {
    await prisma.productListing.deleteMany({
      where: { id: { in: listingIds } },
    });
  }

  if (productIds.length) {
    await prisma.legoProduct.deleteMany({
      where: { id: { in: productIds } },
    });
  }

  if (userIds.length) {
    await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    });
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
// Tests
// ---------------------------------------------------------------------------

describe("receivePurchaseItem integration tests", () => {
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

  async function createPurchaseItem(
    quantity: number,
    linkedToListing = true,
  ): Promise<{
    purchaseItemId: number;
    listingId: number;
  }> {
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
      },
    });

    purchaseItemIds.push(purchaseItem.id);

    // Always return the fixture listing ID, even when the PurchaseItem itself
    // is deliberately left unmatched.
    return {
      purchaseItemId: purchaseItem.id,
      listingId: listing.id,
    };
  }

  it("successfully receives a purchase item", async () => {
    const quantity = 5;

    const { purchaseItemId, listingId } =
      await createPurchaseItem(quantity);

    const listingBefore = await prisma.productListing.findUnique({
      where: { id: listingId },
    });

    assert(listingBefore, "Listing should exist before receive");

    const startingStock = listingBefore.currentStock;

    const result = await receivePurchaseItem(userId, purchaseItemId);

    inventoryMovementIds.push(result.movement.id);

    assert.strictEqual(result.purchaseItem.id, purchaseItemId);
    assert(
      result.purchaseItem.receivedAt instanceof Date,
      "receivedAt should be a Date",
    );

    const persistedItem = await prisma.purchaseItem.findUnique({
      where: { id: purchaseItemId },
    });

    assert(
      persistedItem?.receivedAt instanceof Date,
      "Persisted receivedAt should be set",
    );

    const listingAfter = await prisma.productListing.findUnique({
      where: { id: listingId },
    });

    assert(listingAfter, "Listing should exist after receive");
    assert.strictEqual(
      listingAfter.currentStock,
      startingStock + quantity,
      "Stock should increase by exactly the purchase quantity",
    );

    const movements = await prisma.inventoryMovement.findMany({
      where: { listingId },
    });

    assert.strictEqual(
      movements.length,
      1,
      "Exactly one inventory movement should be created",
    );

    const movement = movements[0];
    assert(movement, "Inventory movement should exist");

    assert.strictEqual(movement.id, result.movement.id);
    assert.strictEqual(movement.type, "PURCHASE_IN");
    assert.strictEqual(movement.quantityChange, quantity);
    assert.strictEqual(movement.listingId, listingId);
    assert.strictEqual(movement.performedByUserId, userId);
    assert.match(
      movement.note,
      new RegExp(`PurchaseItem ${purchaseItemId} received`),
    );
  });

  it("throws PurchaseItemNotFoundError for a missing purchase item", async () => {
    await assert.rejects(
      () => receivePurchaseItem(userId, 2_147_483_647),
      (error) => error instanceof PurchaseItemNotFoundError,
    );
  });

  it("rejects cross-user access without changing inventory", async () => {
    const quantity = 3;

    const { purchaseItemId, listingId } =
      await createPurchaseItem(quantity);

    const otherUser = await prisma.user.create({
      data: {
        email: `user-${randomUUID()}@example.com`,
        passwordHash: "test",
      },
    });

    userIds.push(otherUser.id);

    const listingBefore = await prisma.productListing.findUnique({
      where: { id: listingId },
    });

    assert(listingBefore, "Listing should exist before receive");

    await assert.rejects(
      () => receivePurchaseItem(otherUser.id, purchaseItemId),
      (error) => error instanceof PurchaseItemNotFoundError,
    );

    const itemAfter = await prisma.purchaseItem.findUnique({
      where: { id: purchaseItemId },
    });

    assert(itemAfter, "PurchaseItem should still exist");
    assert.strictEqual(itemAfter.receivedAt, null);

    const listingAfter = await prisma.productListing.findUnique({
      where: { id: listingId },
    });

    assert(listingAfter, "Listing should still exist");
    assert.strictEqual(
      listingAfter.currentStock,
      listingBefore.currentStock,
    );

    const movementCount = await prisma.inventoryMovement.count({
      where: { listingId },
    });

    assert.strictEqual(movementCount, 0);
  });

  it("rolls back when the purchase item has no product listing", async () => {
    const quantity = 2;

    const { purchaseItemId, listingId } =
      await createPurchaseItem(quantity, false);

    const listingBefore = await prisma.productListing.findUnique({
      where: { id: listingId },
    });

    assert(listingBefore, "Fixture listing should exist");

    await assert.rejects(
      () => receivePurchaseItem(userId, purchaseItemId),
      (error) => error instanceof ProductListingMissingError,
    );

    const itemAfter = await prisma.purchaseItem.findUnique({
      where: { id: purchaseItemId },
    });

    assert(itemAfter, "PurchaseItem should still exist");
    assert.strictEqual(
      itemAfter.receivedAt,
      null,
      "receivedAt claim should be rolled back",
    );

    const listingAfter = await prisma.productListing.findUnique({
      where: { id: listingId },
    });

    assert(listingAfter, "Fixture listing should still exist");
    assert.strictEqual(
      listingAfter.currentStock,
      listingBefore.currentStock,
      "Stock should remain unchanged",
    );

    const movementCount = await prisma.inventoryMovement.count({
      where: { listingId },
    });

    assert.strictEqual(movementCount, 0);
  });

  it("rolls back when the purchase item quantity is invalid", async () => {
    const quantity = -1;

    const { purchaseItemId, listingId } =
      await createPurchaseItem(quantity);

    const listingBefore = await prisma.productListing.findUnique({
      where: { id: listingId },
    });

    assert(listingBefore, "Listing should exist before receive");

    await assert.rejects(
      () => receivePurchaseItem(userId, purchaseItemId),
      (error) => error instanceof InvalidQuantityError,
    );

    const itemAfter = await prisma.purchaseItem.findUnique({
      where: { id: purchaseItemId },
    });

    assert(itemAfter, "PurchaseItem should still exist");
    assert.strictEqual(
      itemAfter.receivedAt,
      null,
      "receivedAt claim should be rolled back",
    );

    const listingAfter = await prisma.productListing.findUnique({
      where: { id: listingId },
    });

    assert(listingAfter, "Listing should still exist");
    assert.strictEqual(
      listingAfter.currentStock,
      listingBefore.currentStock,
      "Stock should remain unchanged",
    );

    const movementCount = await prisma.inventoryMovement.count({
      where: { listingId },
    });

    assert.strictEqual(movementCount, 0);
  });

  it("does not receive the same purchase item twice", async () => {
    const quantity = 4;

    const { purchaseItemId, listingId } =
      await createPurchaseItem(quantity);

    const listingBefore = await prisma.productListing.findUnique({
      where: { id: listingId },
    });

    assert(listingBefore, "Listing should exist before receive");

    const first = await receivePurchaseItem(userId, purchaseItemId);

    inventoryMovementIds.push(first.movement.id);

    const firstReceivedAt = first.purchaseItem.receivedAt;

    await assert.rejects(
      () => receivePurchaseItem(userId, purchaseItemId),
      (error) => error instanceof AlreadyReceivedError,
    );

    const itemAfter = await prisma.purchaseItem.findUnique({
      where: { id: purchaseItemId },
    });

    assert(itemAfter?.receivedAt, "receivedAt should remain set");
    assert.strictEqual(
      itemAfter.receivedAt.getTime(),
      firstReceivedAt.getTime(),
      "Second receive attempt must not replace receivedAt",
    );

    const listingAfter = await prisma.productListing.findUnique({
      where: { id: listingId },
    });

    assert(listingAfter, "Listing should still exist");
    assert.strictEqual(
      listingAfter.currentStock,
      listingBefore.currentStock + quantity,
      "Stock should increase exactly once",
    );

    const movements = await prisma.inventoryMovement.findMany({
      where: { listingId },
    });

    assert.strictEqual(
      movements.length,
      1,
      "Only one PURCHASE_IN movement should exist",
    );
    assert.strictEqual(movements[0]?.type, "PURCHASE_IN");
    assert.strictEqual(movements[0]?.quantityChange, quantity);
  });

  it("allows only one concurrent receive for the same purchase item", async () => {
    const quantity = 7;

    const { purchaseItemId, listingId } =
      await createPurchaseItem(quantity);

    const listingBefore = await prisma.productListing.findUnique({
      where: { id: listingId },
    });

    assert(listingBefore, "Listing should exist before concurrent receive");

    const startingStock = listingBefore.currentStock;

    const results = await Promise.allSettled([
      receivePurchaseItem(userId, purchaseItemId),
      receivePurchaseItem(userId, purchaseItemId),
    ]);

    const fulfilled = results.filter(
      (result) => result.status === "fulfilled",
    );

    const rejected = results.filter(
      (result) => result.status === "rejected",
    );

    assert.strictEqual(
      fulfilled.length,
      1,
      "Exactly one concurrent receive should succeed",
    );

    assert.strictEqual(
      rejected.length,
      1,
      "Exactly one concurrent receive should fail",
    );

    const successfulResult = fulfilled[0];
    const rejectedResult = rejected[0];

    assert(
      successfulResult && successfulResult.status === "fulfilled",
      "A fulfilled result should exist",
    );

    assert(
      rejectedResult && rejectedResult.status === "rejected",
      "A rejected result should exist",
    );

    assert(
      rejectedResult.reason instanceof AlreadyReceivedError,
      "Rejected receive should fail with AlreadyReceivedError",
    );

    inventoryMovementIds.push(successfulResult.value.movement.id);

    const itemAfter = await prisma.purchaseItem.findUnique({
      where: { id: purchaseItemId },
    });

    assert(
      itemAfter?.receivedAt instanceof Date,
      "PurchaseItem should be received",
    );

    const listingAfter = await prisma.productListing.findUnique({
      where: { id: listingId },
    });

    assert(listingAfter, "Listing should still exist");

    assert.strictEqual(
      listingAfter.currentStock,
      startingStock + quantity,
      "Concurrent receives must increment stock exactly once",
    );

    const movements = await prisma.inventoryMovement.findMany({
      where: { listingId },
    });

    assert.strictEqual(
      movements.length,
      1,
      "Concurrent receives must create exactly one movement",
    );

    assert.strictEqual(movements[0]?.type, "PURCHASE_IN");
    assert.strictEqual(movements[0]?.quantityChange, quantity);
  });
});