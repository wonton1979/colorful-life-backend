import type { PrismaClient } from "../../generated/prisma-client/client.js";
import { prisma as defaultPrisma } from "../../prisma/runtime.js";
import { lockCategoryFeatureSelection } from "./productListingCreationService.js";

export class FeatureProductNotFoundError extends Error {}
export class FeatureProductCategoryChangedError extends Error {}

export function createProductFeatureService(db: PrismaClient = defaultPrisma) {
  return {
    async setFeature(productId: number) {
      return db.$transaction(async (tx) => {
        const candidate = await tx.legoProduct.findUnique({
          where: { id: productId },
          select: { categoryId: true },
        });
        if (!candidate || candidate.categoryId === null) throw new FeatureProductNotFoundError("Product has no Category");

        // Application selections take the category advisory lock before rows.
        // Direct category writes are protected by the unique index and CHECK,
        // without a row trigger that would acquire these locks in reverse order.
        await lockCategoryFeatureSelection(tx, candidate.categoryId);
        const products = await tx.$queryRaw<Array<{ id: number }>>`
          SELECT lp.id FROM "LegoProduct" lp
          WHERE lp."categoryId" = ${candidate.categoryId}
          ORDER BY lp.id
          FOR UPDATE
        `;
        // A direct category move can commit while we wait. Only proceed if the
        // candidate was actually locked in the category whose advisory lock we
        // own. Never clear another category's feature using a stale lock.
        if (!products.some((product) => product.id === productId)) {
          throw new FeatureProductCategoryChangedError("Product category changed; retry Feature selection");
        }

        await tx.legoProduct.updateMany({
          where: { categoryId: candidate.categoryId, isFeatureProduct: true },
          data: { isFeatureProduct: false },
        });
        return tx.legoProduct.update({
          where: { id: productId },
          data: { isFeatureProduct: true },
          select: { id: true, isFeatureProduct: true },
        });
      });
    },
  };
}
