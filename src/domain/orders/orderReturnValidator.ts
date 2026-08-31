import { z } from "zod";
import {
  ReturnReason,
  ReturnShippingPayer,
} from "../../generated/prisma-client/enums.js";

export const OrderReturnSchema = z
  .object({
    orderItemId: z
      .number()
      .int()
      .positive({ message: "orderItemId must be a positive integer" }),
    quantity: z
      .number()
      .int()
      .positive({ message: "quantity must be a positive integer" }),
    reason: z.nativeEnum(ReturnReason),
    reasonNote: z.string().trim().min(1).optional(),
    shippingPayer: z.nativeEnum(ReturnShippingPayer),
    returnShippingCost: z.number().nonnegative().optional(),
  })
  .strict();

export type OrderReturnInput = z.infer<typeof OrderReturnSchema>;
