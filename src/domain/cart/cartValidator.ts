import { z } from "zod";

export const CartItemSchema = z.object({
  productListingId: z.number().int().positive(),
  quantity: z.number().int().positive(),
});

export const UpdateCartItemSchema = z.object({ quantity: z.number().int().positive() });

export type CartItemInput = z.infer<typeof CartItemSchema>;
