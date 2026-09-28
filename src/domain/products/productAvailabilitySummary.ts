import { Prisma } from "../../generated/prisma-client/client.js";
import type { PrismaClient } from "../../generated/prisma-client/client.js";
import { prisma as defaultPrisma } from "../../prisma/runtime.js";
import { storefrontSellableListingExistsPredicate } from "./storefrontSellability.js";

type AvailabilitySummary = {
  totalProducts: number;
  activeProducts: number;
  inactiveProducts: number;
};

/**
 * Create the shared product availability summary used by category and global
 * Admin endpoints. Products are counted from LegoProduct, while the existing
 * storefront predicate determines whether each product has any sellable offer.
 */
export function createProductAvailabilitySummaryService(db: PrismaClient = defaultPrisma) {
  async function summarize(categoryId?: number): Promise<AvailabilitySummary | null> {
    const productScope = categoryId === undefined
      ? Prisma.sql`FROM "LegoProduct" lp`
      : Prisma.sql`
        FROM "Category" c
        LEFT JOIN "LegoProduct" lp ON lp."categoryId" = c."id"
        WHERE c."id" = ${categoryId}
        GROUP BY c."id"
      `;

    const rows = await db.$queryRaw<Array<{ totalProducts: bigint; activeProducts: bigint }>>(Prisma.sql`
      SELECT COUNT(lp."id") AS "totalProducts",
             COUNT(lp."id") FILTER (WHERE ${storefrontSellableListingExistsPredicate()}) AS "activeProducts"
      ${productScope}
    `);
    const row = rows[0];
    if (!row) return null;

    const totalProducts = Number(row.totalProducts);
    const activeProducts = Number(row.activeProducts);
    return {
      totalProducts,
      activeProducts,
      inactiveProducts: totalProducts - activeProducts,
    };
  }

  return {
    global: () => summarize(),
    forCategory: (categoryId: number) => summarize(categoryId),
  };
}
