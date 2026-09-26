import type { Request, Response } from "express";
import { AdminProductLookupQuerySchema } from "../domain/products/adminProductLookupValidator.js";
import { createAdminProductLookupService } from "../domain/products/adminProductLookupService.js";
import {
  AdminProductCategoryNotFoundError,
  AdminProductNotFoundError,
  createAdminProductUpdateService,
} from "../domain/products/adminProductUpdateService.js";
import { ProductMetadataUpdateSchema } from "../domain/products/productMetadataUpdateValidator.js";
import { Prisma } from "../generated/prisma-client/client.js";

export function createAdminProductsController() {
  const service = createAdminProductLookupService();
  const updateService = createAdminProductUpdateService();
  return {
    search: async (req: Request, res: Response) => {
      const parsed = AdminProductLookupQuerySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      try {
        return res.json(await service.search(parsed.data));
      } catch (error) {
        console.error("Admin product lookup failed", error);
        return res.status(500).json({ error: "Product lookup failed" });
      }
    },
    update: async (req: Request, res: Response) => {
      const productId = Number(req.params.productId);
      if (!Number.isInteger(productId) || productId <= 0) return res.status(404).json({ error: "Product not found" });

      const parsed = ProductMetadataUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });
      if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "No updatable fields provided" });

      try {
        return res.json(await updateService.update(productId, parsed.data));
      } catch (error) {
        if (error instanceof AdminProductNotFoundError) return res.status(404).json({ error: error.message });
        if (error instanceof AdminProductCategoryNotFoundError) return res.status(400).json({ error: error.message });
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const target = error.meta?.target;
          const targetText = Array.isArray(target) ? target.join(",") : String(target ?? "");
          if (targetText.includes("setNumber") || (parsed.data.setNumber !== undefined && parsed.data.categoryId === undefined)) {
            return res.status(409).json({ error: "setNumber already exists" });
          }
          return res.status(409).json({ error: "Product update conflicts with an existing record" });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003" && parsed.data.categoryId !== undefined) {
          return res.status(400).json({ error: "Category not found" });
        }
        console.error("Admin product update failed", error);
        return res.status(500).json({ error: "Product update failed" });
      }
    },
  };
}
