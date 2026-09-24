import type { Request, Response } from "express";
import { AdminProductLookupQuerySchema } from "../domain/products/adminProductLookupValidator.js";
import { createAdminProductLookupService } from "../domain/products/adminProductLookupService.js";

export function createAdminProductsController() {
  const service = createAdminProductLookupService();
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
  };
}
