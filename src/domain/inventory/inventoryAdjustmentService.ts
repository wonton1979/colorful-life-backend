import { prisma } from "../../prisma/runtime.js";
import {
  InventoryAdjustmentReason,
  InventoryAuditAction,
  InventoryMovementType,
  ListingCondition,
} from "../../generated/prisma-client/enums.js";

export type ConditionAdjustmentInput = {
  sourceProductListingId: number;
  targetProductListingId: number;
  quantity: number;
  reason: InventoryAdjustmentReason;
  reasonNote?: string;
  performedByUserId: number;
};

export type WriteOffInput = {
  sourceProductListingId: number;
  quantity: number;
  reason: InventoryAdjustmentReason;
  reasonNote?: string;
  performedByUserId: number;
};

export type StocktakeReconciliationInput = {
  productListingId: number;
  actualStock: number;
  reasonNote?: string;
  performedByUserId: number;
};

export class InvalidInventoryAdjustmentQuantityError extends Error {
  constructor() {
    super("Inventory adjustment quantity must be a positive integer");
    this.name = "InvalidInventoryAdjustmentQuantityError";
  }
}

export class InventoryListingNotFoundError extends Error {
  constructor(listingId: number) {
    super(`Product listing ${listingId} not found`);
    this.name = "InventoryListingNotFoundError";
  }
}

export class InventoryListingsMustDifferError extends Error {
  constructor() {
    super("Source and target product listings must be different");
    this.name = "InventoryListingsMustDifferError";
  }
}

export class InventoryListingsMustShareProductError extends Error {
  constructor() {
    super("Source and target product listings must belong to the same LEGO product");
    this.name = "InventoryListingsMustShareProductError";
  }
}

export class InvalidConditionAdjustmentError extends Error {
  constructor() {
    super("Only NEW stock may be adjusted to USED_LIKE_NEW");
    this.name = "InvalidConditionAdjustmentError";
  }
}

export class InventoryInsufficientStockError extends Error {
  constructor(listingId: number) {
    super(`Insufficient stock for product listing ${listingId}`);
    this.name = "InventoryInsufficientStockError";
  }
}

export class InvalidInventoryAdjustmentReasonError extends Error {
  constructor() {
    super("Invalid inventory adjustment reason");
    this.name = "InvalidInventoryAdjustmentReasonError";
  }
}

export class InvalidStocktakeQuantityError extends Error {
  constructor() {
    super("Actual stock must be a non-negative 32-bit integer");
    this.name = "InvalidStocktakeQuantityError";
  }
}

export class StocktakeListingNotFoundError extends Error {
  constructor(listingId: number) {
    super(`Product listing ${listingId} not found`);
    this.name = "StocktakeListingNotFoundError";
  }
}

export class StocktakeBelowReservedStockError extends Error {
  constructor() {
    super("Actual stock cannot be less than reserved stock");
    this.name = "StocktakeBelowReservedStockError";
  }
}

function validateQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new InvalidInventoryAdjustmentQuantityError();
  }
}

function validateReason(reason: InventoryAdjustmentReason): void {
  if (!Object.values(InventoryAdjustmentReason).includes(reason)) {
    throw new InvalidInventoryAdjustmentReasonError();
  }
}

function normalizedReasonNote(reasonNote: string | undefined): string | undefined {
  const trimmed = reasonNote?.trim();
  return trimmed || undefined;
}

export async function reconcileStocktake(input: StocktakeReconciliationInput) {
  if (!Number.isInteger(input.actualStock) || input.actualStock < 0 || input.actualStock > 2_147_483_647) {
    throw new InvalidStocktakeQuantityError();
  }

  return prisma.$transaction(async (tx) => {
    // Lock the listing before reading its authoritative stock. Other stock
    // mutations must acquire this row lock to update the same ProductListing.
    const rows = await tx.$queryRaw<Array<{ id: number; currentStock: number; reservedStock: number }>>`
      SELECT id, "currentStock", "reservedStock"
      FROM "ProductListing"
      WHERE id = ${input.productListingId}
      FOR UPDATE
    `;
    const listing = rows[0];
    if (!listing) throw new StocktakeListingNotFoundError(input.productListingId);
    if (input.actualStock < listing.reservedStock) {
      throw new StocktakeBelowReservedStockError();
    }

    const quantityChange = input.actualStock - listing.currentStock;
    if (quantityChange === 0) {
      return { listing: { id: listing.id, currentStock: listing.currentStock }, movement: null };
    }

    const updatedRows = await tx.$executeRaw`
      UPDATE "ProductListing"
      SET "currentStock" = ${input.actualStock}
      WHERE id = ${listing.id}
        AND "currentStock" = ${listing.currentStock}
        AND "reservedStock" <= ${input.actualStock}
    `;
    if (updatedRows === 0) {
      // Defensive guard in case the row is ever changed outside this lock path.
      throw new StocktakeBelowReservedStockError();
    }

    const movement = await tx.inventoryMovement.create({
      data: {
        listingId: listing.id,
        quantityChange,
        type: InventoryMovementType.MANUAL_ADJUSTMENT,
        note: normalizedReasonNote(input.reasonNote) ?? `Stocktake reconciliation to ${input.actualStock}`,
        performedByUserId: input.performedByUserId,
      },
    });

    return { listing: { id: listing.id, currentStock: input.actualStock }, movement };
  });
}

export async function conditionAdjustInventory(input: ConditionAdjustmentInput) {
  validateQuantity(input.quantity);
  validateReason(input.reason);

  return prisma.$transaction(async (tx) => {
    if (input.sourceProductListingId === input.targetProductListingId) {
      throw new InventoryListingsMustDifferError();
    }

    const [source, target] = await Promise.all([
      tx.productListing.findUnique({
        where: { id: input.sourceProductListingId },
        select: { id: true, legoProductId: true, condition: true, currentStock: true },
      }),
      tx.productListing.findUnique({
        where: { id: input.targetProductListingId },
        select: { id: true, legoProductId: true, condition: true, currentStock: true },
      }),
    ]);

    if (!source) throw new InventoryListingNotFoundError(input.sourceProductListingId);
    if (!target) throw new InventoryListingNotFoundError(input.targetProductListingId);
    if (source.legoProductId !== target.legoProductId) {
      throw new InventoryListingsMustShareProductError();
    }
    if (
      source.condition !== ListingCondition.NEW ||
      target.condition !== ListingCondition.USED_LIKE_NEW
    ) {
      throw new InvalidConditionAdjustmentError();
    }

    const sourceUpdate = await tx.$executeRaw`
      UPDATE "ProductListing"
      SET "currentStock" = "currentStock" - ${input.quantity}
      WHERE id = ${source.id}
        AND "currentStock" >= ${input.quantity}
        AND "currentStock" - ${input.quantity} >= "reservedStock"
    `;
    if (sourceUpdate === 0) {
      throw new InventoryInsufficientStockError(source.id);
    }

    await tx.productListing.update({
      where: { id: target.id },
      data: { currentStock: { increment: input.quantity } },
    });

    const note = normalizedReasonNote(input.reasonNote);
    const sourceMovement = await tx.inventoryMovement.create({
      data: {
        listingId: source.id,
        quantityChange: -input.quantity,
        type: InventoryMovementType.CONDITION_ADJUSTMENT_SOURCE,
        note: `Condition adjustment ${source.id} -> ${target.id}`,
        performedByUserId: input.performedByUserId,
      },
    });
    const targetMovement = await tx.inventoryMovement.create({
      data: {
        listingId: target.id,
        quantityChange: input.quantity,
        type: InventoryMovementType.CONDITION_ADJUSTMENT_TARGET,
        note: `Condition adjustment ${source.id} -> ${target.id}`,
        performedByUserId: input.performedByUserId,
      },
    });
    const audit = await tx.inventoryAudit.create({
      data: {
        sourceProductListingId: source.id,
        targetProductListingId: target.id,
        action: InventoryAuditAction.CONDITION_ADJUSTMENT,
        quantity: input.quantity,
        reason: input.reason,
        reasonNote: note,
        performedByUserId: input.performedByUserId,
      },
    });

    return { sourceMovement, targetMovement, audit };
  });
}

export async function writeOffInventory(input: WriteOffInput) {
  validateQuantity(input.quantity);
  validateReason(input.reason);

  return prisma.$transaction(async (tx) => {
    const source = await tx.productListing.findUnique({
      where: { id: input.sourceProductListingId },
      select: { id: true },
    });
    if (!source) throw new InventoryListingNotFoundError(input.sourceProductListingId);

    const sourceUpdate = await tx.$executeRaw`
      UPDATE "ProductListing"
      SET "currentStock" = "currentStock" - ${input.quantity}
      WHERE id = ${source.id}
        AND "currentStock" >= ${input.quantity}
        AND "currentStock" - ${input.quantity} >= "reservedStock"
    `;
    if (sourceUpdate === 0) {
      throw new InventoryInsufficientStockError(source.id);
    }

    const movement = await tx.inventoryMovement.create({
      data: {
        listingId: source.id,
        quantityChange: -input.quantity,
        type: InventoryMovementType.WRITE_OFF,
        note: `Inventory write-off for listing ${source.id}`,
        performedByUserId: input.performedByUserId,
      },
    });
    const audit = await tx.inventoryAudit.create({
      data: {
        sourceProductListingId: source.id,
        targetProductListingId: null,
        action: InventoryAuditAction.WRITE_OFF,
        quantity: input.quantity,
        reason: input.reason,
        reasonNote: normalizedReasonNote(input.reasonNote),
        performedByUserId: input.performedByUserId,
      },
    });

    return { movement, audit };
  });
}
