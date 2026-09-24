import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import { prisma } from "../prisma/runtime.js";
import {
  conditionAdjustInventory,
  writeOffInventory,
  InvalidConditionAdjustmentError,
  InvalidInventoryAdjustmentQuantityError,
  InventoryInsufficientStockError,
  InventoryListingNotFoundError,
  InventoryListingsMustDifferError,
  InventoryListingsMustShareProductError,
} from "../domain/inventory/inventoryAdjustmentService.js";
import {
  InventoryAdjustmentReason,
  InventoryAuditAction,
  InventoryMovementType,
} from "../generated/prisma-client/enums.js";

const userIds: number[] = [];
const productIds: number[] = [];
const listingIds: number[] = [];

async function cleanup(): Promise<void> {
  if (listingIds.length) {
    await prisma.inventoryAudit.deleteMany({
      where: {
        OR: [
          { sourceProductListingId: { in: listingIds } },
          { targetProductListingId: { in: listingIds } },
        ],
      },
    });
    await prisma.inventoryMovement.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.productListing.deleteMany({ where: { id: { in: listingIds } } });
  }
  if (productIds.length) {
    await prisma.legoProduct.deleteMany({ where: { id: { in: productIds } } });
  }
  if (userIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  userIds.length = 0;
  productIds.length = 0;
  listingIds.length = 0;
}

afterEach(cleanup);

async function createUser(): Promise<number> {
  const user = await prisma.user.create({
    data: {
      email: `inventory-adjustment-${randomUUID()}@example.com`,
      passwordHash: "test",
      role: "ADMIN",
    },
  });
  userIds.push(user.id);
  return user.id;
}

async function createProduct(): Promise<number> {
  const product = await prisma.legoProduct.create({
    data: {
      setNumber: `INV-${randomUUID()}`,
      title: "Inventory Adjustment Test Product",
      theme: "TEST",
      ageRecommendation: "8+",
      pieceCount: 100,
    },
  });
  productIds.push(product.id);
  return product.id;
}

async function createListing(legoProductId: number, condition: "NEW", currentStock = 0): Promise<number> {
  const listing = await prisma.productListing.create({
    data: {

      legoProductId,
      condition,
      originalPrice: 10,
      currentStock,
    },
  });
  listingIds.push(listing.id);
  return listing.id;
}

async function createPair(sourceStock = 10): Promise<{ sourceId: number; targetId: number; userId: number }> {
  const userId = await createUser();
  const productId = await createProduct();
  const sourceId = await createListing(productId, "NEW", sourceStock);
  const targetId = await createListing(productId, "NEW");
  return { sourceId, targetId, userId };
}

const baseReason = InventoryAdjustmentReason.PACKAGING_DAMAGE;

describe("inventory adjustment domain service", () => {
  it("does not permit pooled condition adjustment now that Used offers represent individual items", async () => {
    const { sourceId, targetId, userId } = await createPair();
    await assert.rejects(() => conditionAdjustInventory({ sourceProductListingId: sourceId, targetProductListingId: targetId, quantity: 1, reason: baseReason, performedByUserId: userId }), InvalidConditionAdjustmentError);
    assert.strictEqual((await prisma.productListing.findUnique({ where: { id: sourceId } }))?.currentStock, 10);
    assert.strictEqual((await prisma.productListing.findUnique({ where: { id: targetId } }))?.currentStock, 0);
    assert.strictEqual(await prisma.inventoryMovement.count({ where: { listingId: { in: [sourceId, targetId] } } }), 0);
  });

  it("performs a write-off and records a source-only movement and audit", async () => {
    const { sourceId, userId } = await createPair(8);
    await writeOffInventory({ sourceProductListingId: sourceId, quantity: 3, reason: InventoryAdjustmentReason.WAREHOUSE_DAMAGE, reasonNote: "  damaged shelf  ", performedByUserId: userId });
    assert.strictEqual((await prisma.productListing.findUnique({ where: { id: sourceId } }))?.currentStock, 5);
    const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { listingId: sourceId } });
    assert.deepStrictEqual({ type: movement.type, quantityChange: movement.quantityChange, performedByUserId: movement.performedByUserId }, { type: InventoryMovementType.WRITE_OFF, quantityChange: -3, performedByUserId: userId });
    const audit = await prisma.inventoryAudit.findFirstOrThrow({ where: { sourceProductListingId: sourceId } });
    assert.deepStrictEqual({ targetProductListingId: audit.targetProductListingId, action: audit.action, quantity: audit.quantity, reason: audit.reason, reasonNote: audit.reasonNote, performedByUserId: audit.performedByUserId }, { targetProductListingId: null, action: InventoryAuditAction.WRITE_OFF, quantity: 3, reason: InventoryAdjustmentReason.WAREHOUSE_DAMAGE, reasonNote: "damaged shelf", performedByUserId: userId });
  });

  it("rolls back an insufficient write-off without side effects", async () => {
    const { sourceId, userId } = await createPair(1);
    await assert.rejects(() => writeOffInventory({ sourceProductListingId: sourceId, quantity: 2, reason: baseReason, performedByUserId: userId }), InventoryInsufficientStockError);
    assert.strictEqual((await prisma.productListing.findUnique({ where: { id: sourceId } }))?.currentStock, 1);
    assert.strictEqual(await prisma.inventoryMovement.count({ where: { listingId: sourceId } }), 0);
    assert.strictEqual(await prisma.inventoryAudit.count({ where: { sourceProductListingId: sourceId } }), 0);
  });

  it("prevents concurrent write-offs from making source stock negative", async () => {
    const { sourceId, userId } = await createPair(5);
    const results = await Promise.allSettled([
      writeOffInventory({ sourceProductListingId: sourceId, quantity: 4, reason: baseReason, performedByUserId: userId }),
      writeOffInventory({ sourceProductListingId: sourceId, quantity: 4, reason: baseReason, performedByUserId: userId }),
    ]);
    assert.strictEqual(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.strictEqual(results.filter((result) => result.status === "rejected" && result.reason instanceof InventoryInsufficientStockError).length, 1);
    assert.strictEqual((await prisma.productListing.findUnique({ where: { id: sourceId } }))?.currentStock, 1);
    assert.strictEqual(await prisma.inventoryMovement.count({ where: { listingId: sourceId } }), 1);
    assert.strictEqual(await prisma.inventoryAudit.count({ where: { sourceProductListingId: sourceId } }), 1);
  });

  it("does not consume stock reserved for pending orders", async () => {
    const { sourceId, userId } = await createPair(5);
    await prisma.productListing.update({ where: { id: sourceId }, data: { reservedStock: 3 } });

    await assert.rejects(
      () => writeOffInventory({ sourceProductListingId: sourceId, quantity: 3, reason: baseReason, performedByUserId: userId }),
      InventoryInsufficientStockError,
    );
    const listing = await prisma.productListing.findUnique({ where: { id: sourceId } });
    assert.strictEqual(listing?.currentStock, 5);
    assert.strictEqual(listing?.reservedStock, 3);
    assert.strictEqual(await prisma.inventoryMovement.count({ where: { listingId: sourceId } }), 0);
    assert.strictEqual(await prisma.inventoryAudit.count({ where: { sourceProductListingId: sourceId } }), 0);
  });

  it("rejects invalid write-off quantities", async () => {
    const { sourceId, userId } = await createPair();
    await assert.rejects(() => writeOffInventory({ sourceProductListingId: sourceId, quantity: 0, reason: baseReason, performedByUserId: userId }), InvalidInventoryAdjustmentQuantityError);
  });

  it("rejects a missing write-off source", async () => {
    const userId = await createUser();
    await assert.rejects(() => writeOffInventory({ sourceProductListingId: 2_147_483_647, quantity: 1, reason: baseReason, performedByUserId: userId }), InventoryListingNotFoundError);
  });
});

function expectAudit(id: number, sourceId: number, targetId: number, userId: number, reasonNote: string) {
  return {
    id,
    sourceProductListingId: sourceId,
    targetProductListingId: targetId,
    action: InventoryAuditAction.CONDITION_ADJUSTMENT,
    quantity: 3,
    reason: baseReason,
    reasonNote,
    performedByUserId: userId,
  };
}
