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

async function createListing(legoProductId: number, condition: "NEW" | "USED_LIKE_NEW", currentStock = 0): Promise<number> {
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
  const targetId = await createListing(productId, "USED_LIKE_NEW");
  return { sourceId, targetId, userId };
}

const baseReason = InventoryAdjustmentReason.PACKAGING_DAMAGE;

describe("inventory adjustment domain service", () => {
  it("performs a condition adjustment and records movements and audit", async () => {
    const { sourceId, targetId, userId } = await createPair();
    const result = await conditionAdjustInventory({
      sourceProductListingId: sourceId,
      targetProductListingId: targetId,
      quantity: 3,
      reason: baseReason,
      reasonNote: "box damaged during inspection",
      performedByUserId: userId,
    });

    assert.strictEqual((await prisma.productListing.findUnique({ where: { id: sourceId } }))?.currentStock, 7);
    assert.strictEqual((await prisma.productListing.findUnique({ where: { id: targetId } }))?.currentStock, 3);

    const movements = await prisma.inventoryMovement.findMany({ where: { listingId: { in: [sourceId, targetId] } } });
    assert.strictEqual(movements.length, 2);
    const sourceMovement = movements.find((movement) => movement.listingId === sourceId)!;
    const targetMovement = movements.find((movement) => movement.listingId === targetId)!;
    assert.deepStrictEqual(
      { type: sourceMovement.type, quantityChange: sourceMovement.quantityChange, performedByUserId: sourceMovement.performedByUserId },
      { type: InventoryMovementType.CONDITION_ADJUSTMENT_SOURCE, quantityChange: -3, performedByUserId: userId },
    );
    assert.deepStrictEqual(
      { type: targetMovement.type, quantityChange: targetMovement.quantityChange, performedByUserId: targetMovement.performedByUserId },
      { type: InventoryMovementType.CONDITION_ADJUSTMENT_TARGET, quantityChange: 3, performedByUserId: userId },
    );

    const audits = await prisma.inventoryAudit.findMany({ where: { sourceProductListingId: sourceId } });
    assert.strictEqual(audits.length, 1);
    assert.deepStrictEqual(
      {
        id: audits[0]!.id,
        sourceProductListingId: audits[0]!.sourceProductListingId,
        targetProductListingId: audits[0]!.targetProductListingId,
        action: audits[0]!.action,
        quantity: audits[0]!.quantity,
        reason: audits[0]!.reason,
        reasonNote: audits[0]!.reasonNote,
        performedByUserId: audits[0]!.performedByUserId,
      },
      expectAudit(audits[0]!.id, sourceId, targetId, userId, "box damaged during inspection"),
    );
    assert(audits[0]!.createdAt instanceof Date);
    assert.strictEqual(result.audit.id, audits[0]!.id);
  });

  it("trims reasonNote", async () => {
    const { sourceId, targetId, userId } = await createPair();
    await conditionAdjustInventory({ sourceProductListingId: sourceId, targetProductListingId: targetId, quantity: 1, reason: baseReason, reasonNote: "  trimmed note  ", performedByUserId: userId });
    assert.strictEqual((await prisma.inventoryAudit.findFirst({ where: { sourceProductListingId: sourceId } }))?.reasonNote, "trimmed note");
  });

  for (const quantity of [0, -1, 1.5]) {
    it(`rejects invalid condition quantity ${quantity}`, async () => {
      const { sourceId, targetId, userId } = await createPair();
      await assert.rejects(() => conditionAdjustInventory({ sourceProductListingId: sourceId, targetProductListingId: targetId, quantity, reason: baseReason, performedByUserId: userId }), InvalidInventoryAdjustmentQuantityError);
    });
  }

  it("rejects a missing source", async () => {
    const { targetId, userId } = await createPair();
    await assert.rejects(() => conditionAdjustInventory({ sourceProductListingId: 2_147_483_647, targetProductListingId: targetId, quantity: 1, reason: baseReason, performedByUserId: userId }), InventoryListingNotFoundError);
  });

  it("rejects a missing target", async () => {
    const { sourceId, userId } = await createPair();
    await assert.rejects(() => conditionAdjustInventory({ sourceProductListingId: sourceId, targetProductListingId: 2_147_483_647, quantity: 1, reason: baseReason, performedByUserId: userId }), InventoryListingNotFoundError);
  });

  it("rejects identical source and target", async () => {
    const { sourceId, userId } = await createPair();
    await assert.rejects(() => conditionAdjustInventory({ sourceProductListingId: sourceId, targetProductListingId: sourceId, quantity: 1, reason: baseReason, performedByUserId: userId }), InventoryListingsMustDifferError);
  });

  it("rejects listings belonging to different products", async () => {
    const userId = await createUser();
    const sourceId = await createListing(await createProduct(), "NEW", 3);
    const targetId = await createListing(await createProduct(), "USED_LIKE_NEW");
    await assert.rejects(() => conditionAdjustInventory({ sourceProductListingId: sourceId, targetProductListingId: targetId, quantity: 1, reason: baseReason, performedByUserId: userId }), InventoryListingsMustShareProductError);
  });

  it("rejects invalid condition transitions", async () => {
    const userId = await createUser();
    const productId = await createProduct();
    const usedSource = await createListing(productId, "USED_LIKE_NEW", 3);
    const newTarget = await createListing(productId, "NEW");
    await assert.rejects(() => conditionAdjustInventory({ sourceProductListingId: usedSource, targetProductListingId: newTarget, quantity: 1, reason: baseReason, performedByUserId: userId }), InvalidConditionAdjustmentError);
    const newSource = await createListing(productId, "NEW", 3);
    await assert.rejects(() => conditionAdjustInventory({ sourceProductListingId: newSource, targetProductListingId: newTarget, quantity: 1, reason: baseReason, performedByUserId: userId }), InvalidConditionAdjustmentError);
  });

  it("rolls back an insufficient condition adjustment without side effects", async () => {
    const { sourceId, targetId, userId } = await createPair(2);
    await assert.rejects(() => conditionAdjustInventory({ sourceProductListingId: sourceId, targetProductListingId: targetId, quantity: 3, reason: baseReason, performedByUserId: userId }), InventoryInsufficientStockError);
    assert.strictEqual((await prisma.productListing.findUnique({ where: { id: sourceId } }))?.currentStock, 2);
    assert.strictEqual((await prisma.productListing.findUnique({ where: { id: targetId } }))?.currentStock, 0);
    assert.strictEqual(await prisma.inventoryMovement.count({ where: { listingId: { in: [sourceId, targetId] } } }), 0);
    assert.strictEqual(await prisma.inventoryAudit.count({ where: { sourceProductListingId: sourceId } }), 0);
  });

  it("prevents concurrent condition adjustments from making source stock negative", async () => {
    const { sourceId, targetId, userId } = await createPair(5);
    const results = await Promise.allSettled([
      conditionAdjustInventory({ sourceProductListingId: sourceId, targetProductListingId: targetId, quantity: 4, reason: baseReason, performedByUserId: userId }),
      conditionAdjustInventory({ sourceProductListingId: sourceId, targetProductListingId: targetId, quantity: 4, reason: baseReason, performedByUserId: userId }),
    ]);
    assert.strictEqual(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.strictEqual(results.filter((result) => result.status === "rejected" && result.reason instanceof InventoryInsufficientStockError).length, 1);
    assert.strictEqual((await prisma.productListing.findUnique({ where: { id: sourceId } }))?.currentStock, 1);
    assert.strictEqual((await prisma.productListing.findUnique({ where: { id: targetId } }))?.currentStock, 4);
    assert.strictEqual(await prisma.inventoryMovement.count({ where: { listingId: sourceId } }), 1);
    assert.strictEqual(await prisma.inventoryAudit.count({ where: { sourceProductListingId: sourceId } }), 1);
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
