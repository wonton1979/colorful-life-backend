import { z } from "zod";

export interface ProductCatalogueQuery {
  q?: string;
  theme?: string;
  minPrice?: number;
  maxPrice?: number;
  page: number;
  pageSize: number;
}

const optionalTrimmed = z.preprocess(
  (value) => typeof value === "string" ? value.trim() || undefined : value,
  z.string().optional(),
);

const optionalNonNegativeDecimal = z.preprocess(
  (value) => {
    if (value === undefined || value === "") return undefined;
    if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value.trim())) return value;
    return Number(value);
  },
  z.number().finite().nonnegative().optional(),
);

const optionalPositiveInteger = z.preprocess(
  (value) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
  z.number().int().positive().optional(),
);

const optionalPageSize = z.preprocess(
  (value) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
  z.number().int().positive().max(100).optional(),
);

export const ProductCatalogueQuerySchema = z.object({
  q: optionalTrimmed,
  theme: optionalTrimmed,
  minPrice: optionalNonNegativeDecimal,
  maxPrice: optionalNonNegativeDecimal,
  page: optionalPositiveInteger.default(1),
  pageSize: optionalPageSize.default(20),
}).refine(
  (query) => query.minPrice === undefined || query.maxPrice === undefined || query.minPrice <= query.maxPrice,
  { message: "minPrice must be less than or equal to maxPrice", path: ["minPrice"] },
).transform((query): ProductCatalogueQuery => ({
  q: query.q,
  theme: query.theme,
  minPrice: query.minPrice,
  maxPrice: query.maxPrice,
  page: query.page,
  pageSize: query.pageSize,
}));
