import { prisma } from "../../prisma/runtime.js";
import { OrderStatus, InventoryMovementType } from "../../generated/prisma-client/enums.js";
import {
  OrderNotFoundError,
  OrderNotConfirmableError,
  InsufficientStockError,
  ProductListingNotFoundError,
} from "./orderConfirmationErrors.js";

/**
 * Confirm a PENDING customer order.
 *
 * This function performs the following steps atomically in a Prisma transaction:
 *   1. Validate that the order exists and is in PENDING status.
 *   2. For each OrderItem, check that the associated ProductListing has enough stock.
 *   3. Decrement the stock of each listing using a conditional update.
 *   4. Create a WEBSITE_SALE InventoryMovement for each item.
 *   5. Update the order status to CONFIRMED.
 *
 * If any item fails the stock check, the entire transaction rolls back.
 *
 * @param orderId The id of the order to confirm.
 * @returns The updated order record.
 */
export async function confirmOrder(adminUserId: number,orderId: number,) {
  const result = await prisma.$transaction(async (tx) => {
    // Load order and its items.
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true },
    });

    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    if (order.status !== OrderStatus.PENDING) {
      throw new OrderNotConfirmableError(orderId, order.status);
    }

    // Validate stock and perform deductions
    for (const item of order.orderItems) {
      const conversionResult = await tx.$executeRaw`
        UPDATE "ProductListing"
        SET "currentStock" = "currentStock" - ${item.quantity},
            "reservedStock" = "reservedStock" - ${item.quantity}
        WHERE id = ${item.productListingId}
          AND "currentStock" >= ${item.quantity}
          AND "reservedStock" >= ${item.quantity}
      `;
      if (conversionResult === 0) {
        const listing = await tx.productListing.findUnique({ where: { id: item.productListingId }, select: { currentStock: true } });
        if (!listing) throw new ProductListingNotFoundError(item.productListingId);
        throw new InsufficientStockError(item.productListingId, listing.currentStock, item.quantity);
      }
      // Create inventory movement
      await tx.inventoryMovement.create({
      data: {
        listingId: item.productListingId,
        quantityChange: -item.quantity,
        type: InventoryMovementType.WEBSITE_SALE,
        performedByUserId: adminUserId,
        note: `Order ${orderId} sale`,
      },
});
    }

    // Update order status to CONFIRMED
    const updatedOrder = await tx.order.update({
      where: { id: orderId, status: OrderStatus.PENDING },
      data: { status: OrderStatus.CONFIRMED, reservationExpiresAt: null },
    });
    return updatedOrder;
  });
  return result;
}
