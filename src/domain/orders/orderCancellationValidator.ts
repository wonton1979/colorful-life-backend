import { z } from "zod";
import {
  CancellationReason,
} from "../../generated/prisma-client/enums.js";

/**
 * Validation schema for the cancel order request body.
 * Uses strict validation to reject unknown fields.
 */
export const CancelOrderSchema = z
  .object({
    reason: z.nativeEnum(CancellationReason),
  })
  .strict();
