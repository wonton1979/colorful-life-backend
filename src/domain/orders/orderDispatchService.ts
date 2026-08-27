import { prisma } from "../../prisma/runtime.js";
import { Decimal } from "@prisma/client/runtime/client";
import { OrderStatus } from "../../generated/prisma-client/enums.js";
import {
  OrderNotFoundError,
  OrderNotDispatchableError,
} from "./orderDispatchErrors.js";

/**
 * Dispatch an order. Only a CONFIRMED order may be dispatched.
 * This operation records shipping details and updates the order status.
 *
 * @param orderId The order to dispatch.
 * @param actualShippingCost The actual cost paid by the seller.
 * @param shippingCarrier The carrier used for shipping.
 * @param trackingNumber Optional tracking number.
 * @returns The updated order.
 * @throws OrderNotFoundError if the order does not exist.
 * @throws OrderNotDispatchableError if the order is not in CONFIRMED status.
 */
export async function dispatchOrder(
  orderId: number,
  actualShippingCost: number,
  shippingCarrier: string,
  trackingNumber?: string,
): Promise<any> {
  const updatedOrder = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.order.updateMany({
      where: {
        id: orderId,
        status: OrderStatus.CONFIRMED,
      },
      data: {
        status: OrderStatus.DISPATCHED,
        actualShippingCost: new Decimal(actualShippingCost),
        shippingCarrier,
        trackingNumber,
        dispatchedAt: new Date(),
      },
    });
    if (updateResult.count === 0) {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) {
        throw new OrderNotFoundError(orderId);
      }
      throw new OrderNotDispatchableError(orderId, order.status as string);
    }
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }
    return order;
  });
  return updatedOrder;
}
