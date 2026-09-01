// Order creation service. Implements the domain rules for creating a
// customer order without touching the database outside a single Prisma
// transaction. The service is intentionally lightweight and returns the
// persisted order (with its items) as returned by Prisma.

import { prisma } from "../../prisma/runtime.js";
import { Decimal } from "@prisma/client/runtime/client";
import type { CreateOrderInput } from "./orderValidator.js";
import {
  NoDefaultBillingAddressError,
  MultipleDefaultBillingAddressesError,
  ProductListingInactiveError,
  ProductListingNotFoundError,
  DuplicateProductListingError,
  InsufficientAvailableStockError,
} from "./orderErrors.js";
import { OrderStatus } from "../../generated/prisma-client/enums.js";
import { expireOrderReservation } from "./orderExpiryService.js";

/**
 * Creates a new order for the supplied user.
 *
 * @param userId The authenticated user's id.
 * @param input   The validated order payload.
 * @returns The created Order record with its OrderItems.
 */
export async function createOrder(
  userId: number,
  input: CreateOrderInput,
){
  // --- 1. Check for duplicate product listings in the request payload
  const listingIdsSet = new Set<number>();
  for (const item of input.items) {
    if (listingIdsSet.has(item.productListingId)) {
      throw new DuplicateProductListingError(item.productListingId);
    }
    listingIdsSet.add(item.productListingId);
  }

  const now = new Date();
  const requestedListingIds = Array.from(listingIdsSet);
  const expiredCandidates = await prisma.order.findMany({
    where: {
      status: OrderStatus.PENDING,
      reservationExpiresAt: { not: null, lte: now },
      orderItems: { some: { productListingId: { in: requestedListingIds } } },
    },
    select: { id: true },
  });

  // Expiry owns the eligibility, locking, payment protection, and release
  // rules. A candidate can become ineligible between discovery and processing;
  // expireOrderReservation treats that as a normal no-op.
  for (const candidate of expiredCandidates) {
    await expireOrderReservation(candidate.id, now);
  }

  // --- 2. Perform all authoritative reads/writes in one transaction
  return prisma.$transaction(async (tx) => {
    // 2a. Billing address
    const defaultBillingAddrs = await tx.address.findMany({
      where: { userId, isDefaultBilling: true },
      select: {
        recipientName: true,
        line1: true,
        line2: true,
        city: true,
        county: true,
        postcode: true,
        countryCode: true,
        phone: true,
      },
    });

    if (defaultBillingAddrs.length === 0) {
      throw new NoDefaultBillingAddressError();
    }
    if (defaultBillingAddrs.length > 1) {
      throw new MultipleDefaultBillingAddressesError();
    }
    const billing = defaultBillingAddrs[0];

    // 2b. Delivery snapshot – use billing if not provided
    const delivery = input.deliveryAddress ?? billing;

    // 2c. Load product listings for requested ids
    const distinctIds = Array.from(listingIdsSet);
    const listings = await tx.productListing.findMany({
      where: { id: { in: distinctIds } },
    });

    // Validate existence
    if (listings.length !== distinctIds.length) {
      const foundIds = new Set(listings.map((l) => l.id));
      const missingId = distinctIds.find((id) => !foundIds.has(id));
      throw new ProductListingNotFoundError(missingId!);
    }
    // Validate active status
    for (const l of listings) {
      if (!l.active) {
        throw new ProductListingInactiveError(l.id);
      }
    }
    const listingMap = new Map<number, typeof listings[0]>();
    listings.forEach((l) => listingMap.set(l.id, l));

    // 2d. Calculate prices and totals
    let totalAmount = new Decimal(0);
    const orderItemCreateData = input.items.map((item) => {
      const listing = listingMap.get(item.productListingId)!;
      const unitPrice = listing.salePrice ?? listing.originalPrice;
      const lineTotal = unitPrice.mul(item.quantity);
      totalAmount = totalAmount.add(lineTotal);
      return {
        productListingId: item.productListingId,
        quantity: item.quantity,
        unitPrice,
        lineTotal,
      };
    });

    const createdAt = now;
    for (const item of orderItemCreateData) {
      const reservationResult = await tx.$executeRaw`
        UPDATE "ProductListing"
        SET "reservedStock" = "reservedStock" + ${item.quantity}
        WHERE id = ${item.productListingId}
          AND "reservedStock" <= "currentStock" - ${item.quantity}
      `;
      if (reservationResult === 0) {
        throw new InsufficientAvailableStockError(item.productListingId, item.quantity);
      }
    }

    // 2e. Persist the order with items
    const order = await tx.order.create({
      data: {
        userId,
        billingRecipientName: billing.recipientName,
        billingLine1: billing.line1,
        billingLine2: billing.line2 ?? undefined,
        billingCity: billing.city,
        billingCounty: billing.county ?? undefined,
        billingPostcode: billing.postcode,
        billingCountryCode: billing.countryCode,
        billingPhone: billing.phone ?? undefined,
        deliveryRecipientName: delivery.recipientName,
        deliveryLine1: delivery.line1,
        deliveryLine2: delivery.line2 ?? undefined,
        deliveryCity: delivery.city,
        deliveryCounty: delivery.county ?? undefined,
        deliveryPostcode: delivery.postcode,
        deliveryCountryCode: delivery.countryCode,
        deliveryPhone: delivery.phone ?? undefined,
        totalAmount,
        createdAt,
        reservationExpiresAt: new Date(createdAt.getTime() + 30 * 60 * 1000),
        orderItems: {
          create: orderItemCreateData,
        },
      },
      include: { orderItems: true },
    });
    return order;
  });
}
