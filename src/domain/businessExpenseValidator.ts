import { z } from "zod";

// Zod schema for creating a business expense. The sourceType and sourceId are
// not exposed to the client – they are set internally by the controller.
export const BusinessExpenseCreateSchema = z.object({
  category: z.enum(["PURCHASE", "SHIPPING", "PLATFORM_FEE", "PACKAGING", "OTHER"]),
  amount: z.number().positive({ message: "amount must be greater than zero" }),
  incurredAt: z
    .string()
    .refine((s) => !isNaN(Date.parse(s)), { message: "Invalid ISO date string" }),
  description: z.string().trim(),
});

export type BusinessExpenseCreateInput = z.infer<typeof BusinessExpenseCreateSchema>;
