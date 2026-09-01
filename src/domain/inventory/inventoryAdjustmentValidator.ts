import { z } from "zod";

const listingId = z.number().int().positive();
const reason = z.enum([
  "CUSTOMER_RETURN_DAMAGED",
  "OPENED_BOX",
  "PACKAGING_DAMAGE",
  "MISSING_PARTS",
  "WAREHOUSE_DAMAGE",
  "QUALITY_ISSUE",
  "OTHER",
]);

const common = {
  sourceProductListingId: listingId,
  quantity: z.number().int().positive(),
  reason,
  reasonNote: z.string().trim().optional(),
};

export const InventoryAdjustmentRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CONDITION_ADJUSTMENT"),
    ...common,
    targetProductListingId: listingId,
  }),
  z.object({
    action: z.literal("WRITE_OFF"),
    ...common,
    targetProductListingId: z.never().optional(),
  }),
]);

export type InventoryAdjustmentRequest = z.infer<typeof InventoryAdjustmentRequestSchema>;
