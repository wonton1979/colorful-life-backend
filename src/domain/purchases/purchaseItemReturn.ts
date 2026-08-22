import { prisma } from "../../prisma/runtime.js";
import { type PurchaseItem, type ProductListing, type InventoryMovement } from "../../generated/prisma-client/client.js";

/**
 * Domain errors used by the purchase item return workflow.
 */
export class PurchaseItemNotFoundError extends Error {
  constructor(message = "Purchase item not found") {
    super(message);
    this.name = "PurchaseItemNotFoundError";
  }
}

export class PurchaseItemNotReceivedError extends Error {
  constructor(message = "Purchase item has not been received yet") {
    super(message);
    this.name = "PurchaseItemNotReceivedError";
  }
}

export class PurchaseItemAlreadyReturnedError extends Error {
  constructor(message = "Purchase item has already been returned") {
    super(message);
    this.name = "PurchaseItemAlreadyReturnedError";
  }
}

export class ProductListingMissingError extends Error {
  constructor(message = "Product listing missing for purchase item") {
    super(message);
    this.name = "ProductListingMissingError";
  }
}

export class InvalidQuantityError extends Error {
  constructor(message = "Purchase item quantity must be > 0") {
    super(message);
    this.name = "InvalidQuantityError";
  }
}

export class InsufficientStockError extends Error {
  constructor(message = "Insufficient stock for return") {
    super(message);
    this.name = "InsufficientStockError";
  }
}

/**
 * Result of a successful purchase item return.
 */
export type PurchaseItemReturnResult = {
  purchaseItem: Pick<PurchaseItem, "id" | "returnedAt">;
  productListing: Pick<ProductListing, "id" | "currentStock">;
  inventoryMovement: Pick<InventoryMovement, "id" | "type" | "quantityChange" | "performedByUserId" | "listingId">;
};

/**
 * Return a fully received purchase item.
 *
 * @param authenticatedUserId - ID of the user performing the return
 * @param purchaseItemId - ID of the purchase item to return
 */
export async function returnPurchaseItem(
  authenticatedUserId: number,
  purchaseItemId: number,
): Promise<PurchaseItemReturnResult> {
  const result = await prisma.$transaction(async (tx) => {
    // Load the purchase item with minimal data needed for ownership checks.
    const purchaseItem = await tx.purchaseItem.findUnique({
      where: { id: purchaseItemId },
      include: { productListing: true, purchaseDocument: true },
    });
    if (!purchaseItem) {
      throw new PurchaseItemNotFoundError();
    }
    if (purchaseItem.purchaseDocument.importedByUserId !== authenticatedUserId) {
      throw new PurchaseItemNotFoundError();
    }

    // Atomically claim the return.
    const claimResult = await tx.purchaseItem.updateMany({
      where: {
        id: purchaseItemId,
        receivedAt: { not: null },
        returnedAt: null,
      },
      data: { returnedAt: new Date() },
    });
    if (claimResult.count === 0) {
      // Reload to inspect why claim failed.
      const latest = await tx.purchaseItem.findUnique({
        where: { id: purchaseItemId },
      });
      if (!latest) {
        throw new PurchaseItemNotFoundError();
      }
      if (latest.receivedAt === null) {
        throw new PurchaseItemNotReceivedError();
      }
      if (latest.returnedAt !== null) {
        throw new PurchaseItemAlreadyReturnedError();
      }
    }

    // Validate quantity and listing.
    const quantity = purchaseItem.quantity;
    if (quantity <= 0) {
      throw new InvalidQuantityError();
    }
    const listingId = purchaseItem.productListingId;
    if (listingId === null) {
      throw new ProductListingMissingError();
    }
    const listing = await tx.productListing.findUnique({
      where: { id: listingId },
    });
    if (!listing) {
      throw new ProductListingMissingError();
    }

    // Attempt atomic stock decrement. Insufficient stock is signalled by count === 0.
    const stockUpdate = await tx.productListing.updateMany({
      where: {
        id: listingId,
        currentStock: { gte: quantity },
      },
      data: {
        currentStock: { decrement: quantity },
      },
    });
    if (stockUpdate.count === 0) {
      throw new InsufficientStockError();
    }

    // Create inventory movement.
    const movement = await tx.inventoryMovement.create({
      data: {
        listingId,
        quantityChange: -quantity,
        type: "PURCHASE_RETURN_OUT",
        performedByUserId: authenticatedUserId,
        note: `Returned purchase item ${purchaseItemId}`,
      },
    });

    // Reload final state for result.
    const finalPurchaseItem = await tx.purchaseItem.findUnique({
      where: { id: purchaseItemId },
    });
    const finalListing = await tx.productListing.findUnique({
      where: { id: listingId },
    });
    if (!finalPurchaseItem || !finalListing) {
      throw new Error("Unexpected missing data after transaction");
    }

    return {
      purchaseItem: {
        id: finalPurchaseItem.id,
        returnedAt: finalPurchaseItem.returnedAt,
      },
      productListing: {
        id: finalListing.id,
        currentStock: finalListing.currentStock,
      },
      inventoryMovement: {
        id: movement.id,
        type: movement.type,
        quantityChange: movement.quantityChange,
        performedByUserId: movement.performedByUserId,
        listingId: movement.listingId,
      },
    };
  });
  return result;
}
