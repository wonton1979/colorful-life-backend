import { z } from "zod";

const positiveInteger = (max: number) => z.preprocess(
  (value) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
  z.number().int().positive().max(max),
);

export const AdminProductLookupQuerySchema = z.object({
  q: z.preprocess(
    (value) => typeof value === "string" ? value.trim() : value,
    z.string().min(1).max(100),
  ),
  page: positiveInteger(10_000).default(1),
  pageSize: positiveInteger(50).default(20),
}).strict();

export type AdminProductLookupQuery = z.infer<typeof AdminProductLookupQuerySchema>;
