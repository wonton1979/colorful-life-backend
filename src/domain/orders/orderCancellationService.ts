import { prisma } from "../../prisma/runtime.js";
import {
  OrderStatus,
  CancellationInitiator,
  CancellationReason,
} from "../../generated/prisma-client/enums.js";
import {
  OrderNotFoundError,
  OrderNotCancellableError,
  InsufficientReservedStockError,
} from "./orderCancellationErrors.js";

/**
 * Cancel an order for an authenticated customer.
 *
 * @param userId Authenticated user id.
 * @param orderId Order id to cancel.
 * @param reason Cancellation reason.
 * @returns Updated order record.
 * @throws OrderNotFoundError          if the order does not exist or does not belong to the user.
 * @throws OrderNotCancellableError    if the order is in a non‑cancellable state.
 */
export async function cancelOrder(
  userId: number,
  orderId: number,
  reason: CancellationReason,
 ) {
  const cancellableStatuses = [OrderStatus.PENDING, OrderStatus.CONFIRMED];

  const updatedOrder = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) {
      throw new OrderNotFoundError(orderId);
    }

    const updateResult = await tx.order.updateMany({
      where: {
        id: orderId,
        userId,
        status: { in: cancellableStatuses },
        cancelledAt: null,
      },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: CancellationInitiator.CUSTOMER,
        cancellationReason: reason,
        reservationExpiresAt: order.status === OrderStatus.PENDING ? null : undefined,
      },
    });

    if (updateResult.count === 0) {
      throw new OrderNotCancellableError(orderId, order.status);
    }

    if (order.status === OrderStatus.PENDING) {
      const orderItems = await tx.orderItem.findMany({ where: { orderId }, select: { productListingId: true, quantity: true } });
      for (const item of orderItems) {
        const released = await tx.productListing.updateMany({
          where: { id: item.productListingId, reservedStock: { gte: item.quantity } },
          data: { reservedStock: { decrement: item.quantity } },
        });
        if (released.count === 0) throw new InsufficientReservedStockError(item.productListingId, item.quantity);
      }
    } else if (order.status === OrderStatus.CONFIRMED) {
      const orderItems = await tx.orderItem.findMany({
        where: { orderId },
        select: { productListingId: true, quantity: true },
      });

      for (const item of orderItems) {
        await tx.productListing.update({
          where: { id: item.productListingId },
          data: { currentStock: { increment: item.quantity } },
        });
        await tx.inventoryMovement.create({
          data: {
            listingId: item.productListingId,
            quantityChange: item.quantity,
            type: "ORDER_CANCELLATION_RETURN",
            performedByUserId: userId,
            note: `Order ${orderId} cancellation return`,
          },
        });
      }
    }

    const updated = await tx.order.findUnique({ where: { id: orderId } });
    if (!updated) {
      throw new OrderNotFoundError(orderId);
    }
    return updated;
  });

  return updatedOrder;
 }
/**
 * Cancel an order by an ADMIN user.
 *
 * @param orderId Order id to cancel.
 * @param reason Cancellation reason.
 * @returns Updated order record.
 * @throws OrderNotFoundError          if the order does not exist.
 * @throws OrderNotCancellableError    if the order is in a non‑cancellable state.
 */
export async function cancelOrderByAdmin(
  orderId: number,
  reason: CancellationReason,
  adminUserId: number,
  ) {
  const cancellableStatuses = [OrderStatus.PENDING, OrderStatus.CONFIRMED];

  const updatedOrder = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    const updateResult = await tx.order.updateMany({
      where: {
        id: orderId,
        status: { in: cancellableStatuses },
        cancelledAt: null,
      },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: CancellationInitiator.SELLER,
        cancellationReason: reason,
        reservationExpiresAt: order.status === OrderStatus.PENDING ? null : undefined,
      },
    });

    if (updateResult.count === 0) {
      throw new OrderNotCancellableError(orderId, order.status);
    }

    if (order.status === OrderStatus.PENDING) {
      const orderItems = await tx.orderItem.findMany({ where: { orderId }, select: { productListingId: true, quantity: true } });
      for (const item of orderItems) {
        const released = await tx.productListing.updateMany({
          where: { id: item.productListingId, reservedStock: { gte: item.quantity } },
          data: { reservedStock: { decrement: item.quantity } },
        });
        if (released.count === 0) throw new InsufficientReservedStockError(item.productListingId, item.quantity);
      }
    } else if (order.status === OrderStatus.CONFIRMED) {
      const orderItems = await tx.orderItem.findMany({
        where: { orderId },
        select: { productListingId: true, quantity: true },
      });

      for (const item of orderItems) {
        await tx.productListing.update({
          where: { id: item.productListingId },
          data: { currentStock: { increment: item.quantity } },
        });
        await tx.inventoryMovement.create({
          data: {
            listingId: item.productListingId,
            quantityChange: item.quantity,
            type: "ORDER_CANCELLATION_RETURN",
            performedByUserId: adminUserId,
            note: `Order ${orderId} cancellation return`,
          },
        });
      }
    }

    const updated = await tx.order.findUnique({ where: { id: orderId } });
    if (!updated) {
      throw new OrderNotFoundError(orderId);
    }
    return updated;
  });

  return updatedOrder;
}
