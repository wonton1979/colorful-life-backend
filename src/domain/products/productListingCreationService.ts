import type { Prisma, PrismaClient } from "../../generated/prisma-client/client.js";
import { prisma as defaultPrisma } from "../../prisma/runtime.js";

export async function lockCategoryFeatureSelection(tx: Prisma.TransactionClient, categoryId: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${categoryId})`;
}

export async function hasCategoryFeatureProduct(tx: Prisma.TransactionClient, categoryId: number): Promise<boolean> {
  const existingFeature = await tx.productListing.findFirst({
    where: { legoProduct: { categoryId }, isFeatureProduct: true },
    select: { id: true },
  });
  return existingFeature !== null;
}

export function createProductListingCreationService(db: PrismaClient = defaultPrisma) {
  return {
    async createForCategory<T>(
      categoryId: number | null,
      createListing: (tx: Prisma.TransactionClient, isFeatureProduct: boolean) => Promise<T>,
    ): Promise<T> {
      return db.$transaction(async (tx) => {
        if (categoryId === null) return createListing(tx, false);
        await lockCategoryFeatureSelection(tx, categoryId);
        return createListing(tx, !(await hasCategoryFeatureProduct(tx, categoryId)));
      });
    },
  };
}
