import { prisma } from "../../prisma/runtime.js";
import { OrderStatus } from "../../generated/prisma-client/enums.js";
// Import the generic OrderNotFoundError used across order flows.
import { OrderNotFoundError } from "./orderDispatchErrors.js";
import { OrderNotCompletableError } from "./orderCompletionErrors.js";

/**
 * Mark an order as COMPLETED. Only an order currently in DISPATCHED status may be completed.
 * The operation is performed atomically using a Prisma transaction that updates the status and
 * records the completion timestamp. The update is conditional on the current status to avoid
 * race conditions.
 *
 * @param orderId The id of the order to complete.
 * @returns The updated order record.
 */
export async function completeOrder(orderId: number) {
  return prisma.$transaction(async (tx) => {
    const updateResult = await tx.order.updateMany({
      where: {
        id: orderId,
        status: OrderStatus.DISPATCHED,
      },
      data: {
        status: OrderStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    if (updateResult.count === 0) {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) {
        throw new OrderNotFoundError(orderId);
      }
      throw new OrderNotCompletableError(orderId, order.status as string);
    }
    const updated = await tx.order.findUnique({ where: { id: orderId } });
    if (!updated) throw new OrderNotFoundError(orderId);
    return updated;
  });
}
