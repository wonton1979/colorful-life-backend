import { Request, Response } from "express";
import { prisma } from "../prisma/runtime.js";

/**
 * GET /products
 * Returns all active product listings with related LegoProduct and ordered listing images.
 */
export const getProducts = async (_req: Request, res: Response) => {
  try {
    const listings = await prisma.productListing.findMany({
      where: { active: true },
      select: {
        id: true,
        legoProductId: true,
        condition: true,
        originalPrice: true,
        salePrice: true,
        currentStock: true,
        createdAt: true,
        updatedAt: true,
        legoProduct: true,
        listingImages: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    res.json(listings);
  } catch (err) {
    console.error("Get products error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /products/:id
 * Returns a single active product listing by numeric listing ID.
 * Returns 404 if not found or inactive.
 */
export const getProductById = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(404).json({ error: "Listing not found" });
  }
  try {
    const listing = await prisma.productListing.findUnique({
      where: { id, active: true },
      select: {
        id: true,
        legoProductId: true,
        condition: true,
        originalPrice: true,
        salePrice: true,
        currentStock: true,
        createdAt: true,
        updatedAt: true,
        legoProduct: true,
        listingImages: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!listing) {
      return res.status(404).json({ error: "Listing not found" });
    }
    res.json(listing);
  } catch (err) {
    console.error("Get product by id error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
