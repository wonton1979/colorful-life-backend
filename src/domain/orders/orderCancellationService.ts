import { prisma } from "../../prisma/runtime.js";
import {
  OrderStatus,
  CancellationInitiator,
  CancellationReason,
} from "../../generated/prisma-client/enums.js";
import {
  OrderNotFoundError,
  OrderNotCancellableError,
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
      },
    });

    if (updateResult.count === 0) {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || order.userId !== userId) {
        throw new OrderNotFoundError(orderId);
      }
      throw new OrderNotCancellableError(orderId, order.status);
    }

    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }
    return order;
  });

  return updatedOrder;
}
