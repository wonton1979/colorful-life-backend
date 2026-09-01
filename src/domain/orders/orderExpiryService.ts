import { prisma } from "../../prisma/runtime.js";
import { OrderStatus, PaymentStatus } from "../../generated/prisma-client/enums.js";
import { InsufficientReservedStockError } from "./orderCancellationErrors.js";

/**
 * Expire one unpaid PENDING order and release its reservation. This operation
 * is intentionally trigger-agnostic; scheduling is handled separately.
 */
export async function expireOrderReservation(orderId: number, asOf = new Date()) {
  return prisma.$transaction(async (tx) => {
    // Use the same order-row lock as payment creation so the payment/expiry
    // decision is serialized across processes.
    await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM "Order"
      WHERE id = ${orderId}
      FOR UPDATE
    `;

    const claim = await tx.order.updateMany({
      where: {
        id: orderId,
        status: OrderStatus.PENDING,
        reservationExpiresAt: { not: null, lte: asOf },
        payments: { none: { status: PaymentStatus.SUCCEEDED } },
      },
      data: {
        status: OrderStatus.EXPIRED,
        reservationExpiresAt: null,
      },
    });

    if (claim.count === 0) return null;

    const items = await tx.orderItem.findMany({
      where: { orderId },
      select: { productListingId: true, quantity: true },
    });
    for (const item of items) {
      const release = await tx.productListing.updateMany({
        where: {
          id: item.productListingId,
          reservedStock: { gte: item.quantity },
        },
        data: { reservedStock: { decrement: item.quantity } },
      });
      if (release.count === 0) {
        throw new InsufficientReservedStockError(item.productListingId, item.quantity);
      }
    }

    return tx.order.findUnique({ where: { id: orderId } });
  });
}
