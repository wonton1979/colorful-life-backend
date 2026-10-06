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
      conditionSnapshot: true,
      damageDescriptionSnapshot: true,
      conditionPhotoSnapshot: true,
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
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: {
      ...orderReadSelect,
      reservationExpiresAt: true,
      billingRecipientName: true, billingLine1: true, billingLine2: true,
      billingCity: true, billingCounty: true, billingPostcode: true,
      billingCountryCode: true, billingPhone: true,
      deliveryRecipientName: true, deliveryLine1: true, deliveryLine2: true,
      deliveryCity: true, deliveryCounty: true, deliveryPostcode: true,
      deliveryCountryCode: true, deliveryPhone: true,
      payments: { select: { status: true, paidAt: true } },
    },
  });
  if (!order) return null;
  const { payments, ...safeOrder } = order;
  return { ...safeOrder, payment: payments[0] ?? null };
}
