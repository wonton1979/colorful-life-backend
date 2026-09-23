import type { PrismaClient } from "../../generated/prisma-client/client.js";
import { prisma as defaultPrisma } from "../../prisma/runtime.js";
import { lockCategoryFeatureSelection } from "./productListingCreationService.js";

export class FeatureListingNotFoundError extends Error {}

export function createProductFeatureService(db: PrismaClient = defaultPrisma) {
  return {
    async setFeature(listingId: number) {
      return db.$transaction(async (tx) => {
        const candidate = await tx.productListing.findUnique({
          where: { id: listingId },
          select: { legoProduct: { select: { categoryId: true } } },
        });
        if (!candidate || candidate.legoProduct.categoryId === null) throw new FeatureListingNotFoundError("Listing has no Category");

        // Lock the complete category set so concurrent selections serialize.
        // The advisory lock is category-scoped because Category now belongs to
        // LegoProduct and cannot be represented by a ProductListing index.
        await lockCategoryFeatureSelection(tx, candidate.legoProduct.categoryId);
        await tx.$queryRaw`
          SELECT pl.id FROM "ProductListing" pl
          JOIN "LegoProduct" lp ON lp.id = pl."legoProductId"
          WHERE lp."categoryId" = ${candidate.legoProduct.categoryId}
          ORDER BY pl.id
          FOR UPDATE
        `;
        const listing = await tx.productListing.findUnique({
          where: { id: listingId },
          select: { id: true, legoProduct: { select: { categoryId: true } } },
        });
        if (!listing || listing.legoProduct.categoryId === null) throw new FeatureListingNotFoundError("Listing has no Category");

        await tx.productListing.updateMany({
          where: { legoProduct: { categoryId: listing.legoProduct.categoryId }, isFeatureProduct: true },
          data: { isFeatureProduct: false },
        });
        return tx.productListing.update({
          where: { id: listingId },
          data: { isFeatureProduct: true },
          select: { id: true, isFeatureProduct: true },
        });
      });
    },
  };
}
