import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "../generated/prisma-client/client.js";
import type { ImageStorage } from "../infrastructure/imageStorage/imageStorage.js";
import { createCategoryManagementService } from "../domain/categories/categoryManagementService.js";

describe("category artwork service", () => {
  it("keeps a committed thumbnail when the response read fails after upload", async () => {
    const category = {
      id: 23,
      imagePublicId: null as string | null,
      thumbnailPublicId: null as string | null,
      imageUrl: null as string | null,
      thumbnailUrl: null as string | null,
    };
    const storedPublicIds: string[] = [];
    const deletedPublicIds: string[] = [];
    const rowDb = {
      category: {
        findUnique: async () => ({ id: category.id, imagePublicId: category.imagePublicId, thumbnailPublicId: category.thumbnailPublicId }),
        update: async ({ data }: { data: Record<string, string | null> }) => Object.assign(category, data),
        findUniqueOrThrow: async () => { throw new Error("response read failed"); },
      },
      $queryRaw: async () => [{ id: category.id }],
    };
    const db = {
      ...rowDb,
      $transaction: async (callback: (tx: typeof rowDb) => Promise<unknown>) => callback(rowDb),
    } as unknown as PrismaClient;
    const storage: ImageStorage = {
      async upload({ publicId }) {
        const id = `colorful-life/category-artwork/${publicId}`;
        storedPublicIds.push(id);
        return { publicId: id, secureUrl: `https://cdn.example/${id}.jpg` };
      },
      async delete(publicId) { deletedPublicIds.push(publicId); },
    };
    const file = {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0, 1, 0, 0, 0, 0xff, 0xd9]),
      size: 20,
      mimetype: "image/jpeg",
    } as Express.Multer.File;

    const service = createCategoryManagementService(storage, db);
    await assert.rejects(service.setThumbnailArtwork(category.id, file), /response read failed/);

    assert.equal(category.thumbnailUrl, `https://cdn.example/${storedPublicIds[0]}.jpg`);
    assert.equal(category.thumbnailPublicId, storedPublicIds[0]);
    assert.deepEqual(deletedPublicIds, []);
  });
});
