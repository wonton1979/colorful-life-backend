import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma-client/client.js";
import { prisma as defaultPrisma } from "../../prisma/runtime.js";
import type { ImageStorage } from "../../infrastructure/imageStorage/imageStorage.js";
import { isOwnedCatalogueArtworkPublicId } from "../../infrastructure/imageStorage/cloudinaryImageStorage.js";
import { validateImage } from "../listingImages/listingImageValidator.js";

export class CatalogueArtworkListingNotFoundError extends Error {}

type Db = PrismaClient;

async function lockListing(tx: Db, listingId: number) {
  await tx.$queryRaw`SELECT id FROM "ProductListing" WHERE id = ${listingId} FOR UPDATE`;
}

export function createCatalogueArtworkService(storage: ImageStorage, db: Db = defaultPrisma) {
  return {
    async set(listingId: number, file: Express.Multer.File | undefined) {
      const { mimeType } = await validateImage(file);
      const existing = await db.productListing.findUnique({
        where: { id: listingId },
        select: { id: true, catalogueArtworkPublicId: true },
      });
      if (!existing) throw new CatalogueArtworkListingNotFoundError("Listing not found");

      const stored = await storage.upload({ buffer: file!.buffer, mimeType, publicId: `${listingId}-${randomUUID()}` });
      try {
        const previous = await db.$transaction(async (tx) => {
          await lockListing(tx as Db, listingId);
          const listing = await tx.productListing.findUnique({ where: { id: listingId }, select: { catalogueArtworkPublicId: true } });
          if (!listing) throw new CatalogueArtworkListingNotFoundError("Listing not found");
          await tx.productListing.update({
            where: { id: listingId },
            data: { catalogueArtworkUrl: stored.secureUrl, catalogueArtworkPublicId: stored.publicId },
          });
          return listing.catalogueArtworkPublicId;
        });
        if (previous && previous !== stored.publicId && isOwnedCatalogueArtworkPublicId(previous, listingId)) {
          try { await storage.delete(previous); } catch (error) {
            console.error("Catalogue artwork replacement cleanup failed", error instanceof Error ? error.message : "unknown error");
          }
        }
        return { url: stored.secureUrl, publicId: stored.publicId };
      } catch (error) {
        try { await storage.delete(stored.publicId); } catch (compensationError) {
          console.error("Catalogue artwork upload compensation failed", compensationError instanceof Error ? compensationError.message : "unknown error");
        }
        throw error;
      }
    },

    async remove(listingId: number) {
      const previous = await db.$transaction(async (tx) => {
        await lockListing(tx as Db, listingId);
        const listing = await tx.productListing.findUnique({ where: { id: listingId }, select: { catalogueArtworkPublicId: true } });
        if (!listing) throw new CatalogueArtworkListingNotFoundError("Listing not found");
        await tx.productListing.update({ where: { id: listingId }, data: { catalogueArtworkUrl: null, catalogueArtworkPublicId: null } });
        return listing.catalogueArtworkPublicId;
      });
      if (previous && isOwnedCatalogueArtworkPublicId(previous, listingId)) {
        try { await storage.delete(previous); } catch (error) {
          console.error("Catalogue artwork removal cleanup failed", error instanceof Error ? error.message : "unknown error");
        }
      }
    },
  };
}
