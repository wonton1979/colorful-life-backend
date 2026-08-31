import { z } from "zod";
import { ReturnCondition } from "../../generated/prisma-client/enums.js";

export const OrderReturnInspectionSchema = z
  .object({
    condition: z.nativeEnum(ReturnCondition),
    restockQuantity: z.number().int().nonnegative(),
    inspectionNote: z
      .string()
      .transform((value) => value.trim())
      .refine((value) => value.length > 0, {
        message: "Inspection note cannot be empty",
      })
      .optional(),
  })
  .strict();
