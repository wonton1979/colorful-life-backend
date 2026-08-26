import { z } from "zod";
import {
  CancellationReason,
} from "../../generated/prisma-client/enums.js";

// Subsets of cancellation reasons for customer and seller flows
const customerReasons = new Set<CancellationReason>([
  CancellationReason.CHANGED_MIND,
  CancellationReason.ORDERED_BY_MISTAKE,
  CancellationReason.ADDRESS_PROBLEM,
  CancellationReason.FOUND_CHEAPER_ELSEWHERE,
  CancellationReason.OTHER,
]);

const sellerReasons = new Set<CancellationReason>([
  CancellationReason.OUT_OF_STOCK,
  CancellationReason.PRICING_ERROR,
  CancellationReason.PRODUCT_UNAVAILABLE,
  CancellationReason.FULFILMENT_ISSUE,
  CancellationReason.OTHER,
]);
/**
 * Validation schema for customer cancel order request body.
 */
export const CancelOrderSchema = z
  .object({
    reason: z.nativeEnum(CancellationReason).refine((r) => customerReasons.has(r), {
      message: "Invalid cancellation reason for customer",
    }),
  })
  .strict();

/**
 * Validation schema for seller (ADMIN) cancel order request body.
 */
export const SellerCancelOrderSchema = z
  .object({
    reason: z.nativeEnum(CancellationReason).refine((r) => sellerReasons.has(r), {
      message: "Invalid cancellation reason for seller",
    }),
  })
  .strict();
