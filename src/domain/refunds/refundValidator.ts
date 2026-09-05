import { z } from "zod";

export const CreateRefundSchema = z
  .object({
    paymentId: z.number().int().positive(),
    amount: z.number().positive(),
    providerReference: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1).optional(),
    refundId: z.number().int().positive().optional(),
  })
  .strict();

export type CreateRefundInput = z.infer<typeof CreateRefundSchema>;
