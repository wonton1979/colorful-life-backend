import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma-client/client.js";
import { prisma as defaultPrisma } from "../../prisma/runtime.js";
import type { ImageStorage } from "../../infrastructure/imageStorage/imageStorage.js";
import { isOwnedProductPublicId, PRODUCT_IMAGE_FOLDER } from "../../infrastructure/imageStorage/cloudinaryImageStorage.js";
import {
  ImageLimitExceededError, ImageNamespaceError, InvalidImageOrderError, ListingImageNotFoundError, ListingNotFoundError,
} from "./listingImageErrors.js";
import { MAX_IMAGES_PER_LISTING, parseOptionalAltText, validateImage } from "./listingImageValidator.js";

type Db = PrismaClient;

async function lockListing(tx: Db, listingId: number) {
  await tx.$queryRaw`SELECT id FROM "ProductListing" WHERE id = ${listingId} FOR UPDATE`;
}

export function createListingImageService(storage: ImageStorage, db: Db = defaultPrisma) {
  return {
    async upload(listingId: number, file: Express.Multer.File | undefined, altTextValue: unknown) {
      const { mimeType } = await validateImage(file);
      const altText = parseOptionalAltText(altTextValue);
      const existingListing = await db.productListing.findUnique({ where: { id: listingId }, select: { id: true } });
      if (!existingListing) throw new ListingNotFoundError("Listing not found");
      const publicIdBasename = `${listingId}-${randomUUID()}`;
      const stored = await storage.upload({ buffer: file!.buffer, mimeType, publicId: publicIdBasename });
      try {
        return await db.$transaction(async (tx) => {
          await lockListing(tx as Db, listingId);
          const listing = await tx.productListing.findUnique({ where: { id: listingId }, select: { id: true } });
          if (!listing) throw new ListingNotFoundError("Listing not found");
          const count = await tx.listingImage.count({ where: { listingId } });
          if (count >= MAX_IMAGES_PER_LISTING) throw new ImageLimitExceededError("Maximum of 10 images per listing reached");
          return tx.listingImage.create({
            data: { listingId, url: stored.secureUrl, publicId: stored.publicId, altText: altText ?? null, sortOrder: count },
          });
        });
      } catch (error) {
        try { await storage.delete(stored.publicId); } catch (compensationError) {
          console.error("Listing image upload compensation failed", compensationError instanceof Error ? compensationError.message : "unknown error");
        }
        throw error;
      }
    },

    async reorder(listingId: number, imageIdsValue: unknown) {
      if (!Array.isArray(imageIdsValue) || imageIdsValue.some((value) => !Number.isInteger(value) || value <= 0)) {
        throw new InvalidImageOrderError("imageIds must be an array of positive integers");
      }
      const imageIds = imageIdsValue as number[];
      return db.$transaction(async (tx) => {
        await lockListing(tx as Db, listingId);
        const listing = await tx.productListing.findUnique({ where: { id: listingId }, select: { id: true } });
        if (!listing) throw new ListingNotFoundError("Listing not found");
        const images = await tx.listingImage.findMany({ where: { listingId }, select: { id: true } });
        const expected = new Set(images.map((image) => image.id));
        if (new Set(imageIds).size !== imageIds.length || imageIds.length !== images.length || imageIds.some((id) => !expected.has(id))) {
          throw new InvalidImageOrderError("imageIds must contain every image exactly once");
        }
        for (const [sortOrder, id] of imageIds.entries()) {
          await tx.listingImage.update({ where: { id }, data: { sortOrder } });
        }
        return tx.listingImage.findMany({ where: { listingId }, orderBy: { sortOrder: "asc" } });
      });
    },

    async updateAltText(listingId: number, imageId: number, altTextValue: unknown) {
      const altText = parseOptionalAltText(altTextValue);
      const image = await db.listingImage.findUnique({ where: { id: imageId } });
      if (!image || image.listingId !== listingId) throw new ListingImageNotFoundError("Image not found");
      return db.listingImage.update({ where: { id: imageId }, data: { altText: altText ?? null } });
    },

    async delete(listingId: number, imageId: number) {
      const image = await db.listingImage.findUnique({ where: { id: imageId } });
      if (!image || image.listingId !== listingId) throw new ListingImageNotFoundError("Image not found");
      if (!isOwnedProductPublicId(image.publicId, listingId)) throw new ImageNamespaceError("Image is outside the product namespace");
      await storage.delete(image.publicId);
      return db.$transaction(async (tx) => {
        await lockListing(tx as Db, listingId);
        const current = await tx.listingImage.findUnique({ where: { id: imageId } });
        if (!current || current.listingId !== listingId) throw new ListingImageNotFoundError("Image not found");
        await tx.listingImage.delete({ where: { id: imageId } });
        const remaining = await tx.listingImage.findMany({ where: { listingId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
        for (const [sortOrder, remainingImage] of remaining.entries()) {
          await tx.listingImage.update({ where: { id: remainingImage.id }, data: { sortOrder } });
        }
        return remaining.map((remainingImage, sortOrder) => ({ ...remainingImage, sortOrder }));
      });
    },
  };
}
