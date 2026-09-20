import type { Request, Response } from "express";
import { listCategories } from "../domain/categories/categoryCatalog.js";

export async function getCategories(_req: Request, res: Response) {
  try {
    res.json(await listCategories());
  } catch (error) {
    console.error("Get categories error", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
