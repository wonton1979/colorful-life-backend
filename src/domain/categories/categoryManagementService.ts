import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma-client/client.js";
import { prisma as defaultPrisma } from "../../prisma/runtime.js";
import type { ImageStorage } from "../../infrastructure/imageStorage/imageStorage.js";
import { isOwnedCategoryArtworkPublicId } from "../../infrastructure/imageStorage/cloudinaryImageStorage.js";
import { validateImage } from "../listingImages/listingImageValidator.js";

export class CategoryNotFoundError extends Error {}
type Db = PrismaClient;
const categorySelect = { id: true, name: true, subtitle: true, description: true, imageUrl: true, imagePublicId: true } as const;
async function lockCategory(tx: Db, categoryId: number) {
  await tx.$queryRaw`SELECT id FROM "Category" WHERE id = ${categoryId} FOR UPDATE`;
}
export function createCategoryManagementService(storage: ImageStorage, db: Db = defaultPrisma) {
  return {
    async list() { return db.category.findMany({ orderBy: { id: "asc" }, select: categorySelect }); },
    async update(categoryId: number, data: { name: string; subtitle: string | null; description: string | null }) {
      if (!await db.category.findUnique({ where: { id: categoryId }, select: { id: true } })) throw new CategoryNotFoundError("Category not found");
      await db.category.update({ where: { id: categoryId }, data });
      return db.category.findUniqueOrThrow({ where: { id: categoryId }, select: categorySelect });
    },
    async setArtwork(categoryId: number, file: Express.Multer.File | undefined) {
      const { mimeType } = await validateImage(file);
      const existing = await db.category.findUnique({ where: { id: categoryId }, select: { id: true, imagePublicId: true } });
      if (!existing) throw new CategoryNotFoundError("Category not found");
      const stored = await storage.upload({ buffer: file!.buffer, mimeType, publicId: `${categoryId}-${randomUUID()}` });
      try {
        const previous = await db.$transaction(async (tx) => {
          await lockCategory(tx as Db, categoryId);
          const category = await tx.category.findUnique({ where: { id: categoryId }, select: { imagePublicId: true } });
          if (!category) throw new CategoryNotFoundError("Category not found");
          await tx.category.update({ where: { id: categoryId }, data: { imageUrl: stored.secureUrl, imagePublicId: stored.publicId } });
          return category.imagePublicId;
        });
        if (previous && previous !== stored.publicId && isOwnedCategoryArtworkPublicId(previous, categoryId)) {
          try { await storage.delete(previous); } catch (error) { console.error("Category artwork replacement cleanup failed", error instanceof Error ? error.message : "unknown error"); }
        }
        return db.category.findUniqueOrThrow({ where: { id: categoryId }, select: categorySelect });
      } catch (error) {
        try { await storage.delete(stored.publicId); } catch (compensationError) { console.error("Category artwork upload compensation failed", compensationError instanceof Error ? compensationError.message : "unknown error"); }
        throw error;
      }
    },
    async removeArtwork(categoryId: number) {
      const previous = await db.$transaction(async (tx) => {
        await lockCategory(tx as Db, categoryId);
        const category = await tx.category.findUnique({ where: { id: categoryId }, select: { imagePublicId: true } });
        if (!category) throw new CategoryNotFoundError("Category not found");
        await tx.category.update({ where: { id: categoryId }, data: { imageUrl: null, imagePublicId: null } });
        return category.imagePublicId;
      });
      if (previous && isOwnedCategoryArtworkPublicId(previous, categoryId)) {
        try { await storage.delete(previous); } catch (error) { console.error("Category artwork removal cleanup failed", error instanceof Error ? error.message : "unknown error"); }
      }
      return db.category.findUniqueOrThrow({ where: { id: categoryId }, select: categorySelect });
    },
  };
}
