import { prisma } from "../../prisma/runtime.js";
import { InventoryMovementType } from "../../generated/prisma-client/enums.js";

/**
 * Domain error thrown when a PurchaseItem cannot be found or does not belong to the supplied user.
 * The same error is used for missing items and for items belonging to another user so that
 * external callers cannot distinguish between the two cases.
 */
export class PurchaseItemNotFoundError extends Error {
  constructor() {
    super("Purchase item not found");
    this.name = "PurchaseItemNotFoundError";
  }
}

/**
 * Domain error thrown when a purchase item has already been received.
 */
export class AlreadyReceivedError extends Error {
  constructor() {
    super("Purchase item already received");
    this.name = "AlreadyReceivedError";
  }
}

/**
 * Domain error thrown when the quantity of a purchase item is zero or negative.
 */
export class InvalidQuantityError extends Error {
  constructor() {
    super("Purchase item quantity must be positive");
    this.name = "InvalidQuantityError";
  }
}

/**
 * Domain error thrown when a purchase item is missing a matching ProductListing.
 */
export class ProductListingMissingError extends Error {
  constructor() {
    super("Purchase item has no associated product listing");
    this.name = "ProductListingMissingError";
  }
}

/**
 * Result returned by the receive service.
 */
export interface ReceiveResult {
  purchaseItem: {
    id: number;
    receivedAt: Date;
  };
  listing: {
    id: number;
    currentStock: number;
  };
  movement: {
    id: number;
    type: InventoryMovementType;
    quantityChange: number;
    performedByUserId: number;
    note: string;
    createdAt: Date;
  };
}

/**
 * Atomically receives a purchase item, increments stock, and records an inventory movement.
 *
 * The operation is fully transactional and uses a conditional UPDATE to claim the
 * purchase item.  This guarantees that concurrent attempts to receive the same
 * item will only succeed once.
 *
 * @param userId          Authenticated user performing the receive.
 * @param purchaseItemId  ID of the purchase item to receive.
 * @throws PurchaseItemNotFoundError   If the item does not exist or does not belong to the user.
 * @throws AlreadyReceivedError        If the item has already been received.
 * @throws InvalidQuantityError        If the item quantity is <= 0.
 * @throws ProductListingMissingError  If the item is not linked to a product listing.
 */
export async function receivePurchaseItem(
  userId: number,
  purchaseItemId: number
): Promise<ReceiveResult> {
  // All operations, including ownership lookup, must occur in a single
  // transaction to guarantee isolation and avoid race conditions.
  const result = await prisma.$transaction(async (tx) => {
    // 1️⃣ Lookup the purchase item to ensure it exists and is owned by the
    //    requesting user.
    const preliminary = await tx.purchaseItem.findUnique({
      where: { id: purchaseItemId },
      select: {
        id: true,
        purchaseDocument: { select: { importedByUserId: true } },
      },
    });

    if (!preliminary || preliminary.purchaseDocument.importedByUserId !== userId) {
      throw new PurchaseItemNotFoundError();
    }

    // 2️⃣  Claim the item – set receivedAt only if it is currently NULL.
    const claim = await tx.purchaseItem.updateMany({
      where: { id: purchaseItemId, receivedAt: null },
      data: { receivedAt: new Date() },
    });

    if (claim.count === 0) {
      throw new AlreadyReceivedError();
    }

    // 3️⃣  Retrieve the claimed item to get quantity and listing link.
    const item = await tx.purchaseItem.findUnique({
      where: { id: purchaseItemId },
      select: {
        id: true,
        quantity: true,
        productListingId: true,
        receivedAt: true,
      },
    });

    if (!item) {
      // This should never happen – the claim succeeded earlier.
      throw new Error("Purchase item missing after claim");
    }

    if (!item.productListingId) {
      throw new ProductListingMissingError();
    }

    if (item.quantity <= 0) {
      throw new InvalidQuantityError();
    }

    // 4️⃣  Increment stock atomically.
    const updatedListing = await tx.productListing.update({
      where: { id: item.productListingId },
      data: { currentStock: { increment: item.quantity } },
      select: { id: true, currentStock: true },
    });

    // 5️⃣  Record inventory movement.
    const movement = await tx.inventoryMovement.create({
      data: {
        listingId: item.productListingId,
        quantityChange: item.quantity,
        type: InventoryMovementType.PURCHASE_IN,
        note: `PurchaseItem ${item.id} received`,
        performedByUserId: userId,
      },
      select: {
        id: true,
        type: true,
        quantityChange: true,
        listingId: true,
        performedByUserId: true,
        note: true,
        createdAt: true,
      },
    });

    return {
      purchaseItem: { id: item.id, receivedAt: item.receivedAt! },
      listing: { id: updatedListing.id, currentStock: updatedListing.currentStock },
      movement,
    };
  });

  return result;
}
