import type { PrismaClient } from "../../generated/prisma-client/client.js";
import { prisma as defaultPrisma } from "../../prisma/runtime.js";

export class FeatureListingNotFoundError extends Error {}

export function createProductFeatureService(db: PrismaClient = defaultPrisma) {
  return {
    async setFeature(listingId: number) {
      return db.$transaction(async (tx) => {
        const candidate = await tx.productListing.findUnique({
          where: { id: listingId },
          select: { colorfulLifeCategory: true },
        });
        if (!candidate) throw new FeatureListingNotFoundError("Listing not found");

        // Lock the complete category set so concurrent selections serialize.
        await tx.$queryRaw`
          SELECT id FROM "ProductListing"
          WHERE "colorfulLifeCategory" = ${candidate.colorfulLifeCategory}
          ORDER BY id
          FOR UPDATE
        `;
        const listing = await tx.productListing.findUnique({
          where: { id: listingId },
          select: { id: true, colorfulLifeCategory: true },
        });
        if (!listing) throw new FeatureListingNotFoundError("Listing not found");

        await tx.productListing.updateMany({
          where: { colorfulLifeCategory: listing.colorfulLifeCategory, isFeatureProduct: true },
          data: { isFeatureProduct: false },
        });
        return tx.productListing.update({
          where: { id: listingId },
          data: { isFeatureProduct: true },
          select: { id: true, colorfulLifeCategory: true, isFeatureProduct: true },
        });
      });
    },
  };
}
