import { prisma } from "../../prisma/runtime.js";

const orderReadSelect = {
  id: true,
  status: true,
  totalAmount: true,
  createdAt: true,
  updatedAt: true,
  shippingCarrier: true,
  trackingNumber: true,
  dispatchedAt: true,
  completedAt: true,
  orderItems: {
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      productListing: {
        select: {
          id: true,
          condition: true,
          legoProduct: { select: { id: true, setNumber: true, title: true } },
        },
      },
    },
  },
} as const;

export type CustomerOrder = Awaited<ReturnType<typeof getCustomerOrder>>;

export async function listCustomerOrders(userId: number) {
  return prisma.order.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: orderReadSelect,
  });
}

export async function getCustomerOrder(userId: number, orderId: number) {
  return prisma.order.findFirst({
    where: { id: orderId, userId },
    select: orderReadSelect,
  });
}
