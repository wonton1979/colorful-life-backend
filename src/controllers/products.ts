import { Request, Response } from "express";
import { prisma } from "../prisma/runtime.js";
import { z } from "zod";
import { ListingCondition } from "../generated/prisma-client/enums.js";
import { Prisma } from "../generated/prisma-client/client.js";

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
 * POST /products
 * Creates a new Lego product and its product listing in a single atomic transaction.
 * The request body must contain all required fields; numeric values are expected as JSON numbers.
 *
 * @body
 *   - setNumber: string
 *   - title: string
 *   - description?: string
 *   - theme: string
 *   - ageRecommendation: string
 *   - pieceCount: number
 *   - condition: "NEW" | "USED_LIKE_NEW"
 *   - originalPrice: number
 *   - salePrice?: number
 *   - currentStock?: number
 */
export const createProduct = async (req: Request, res: Response) => {
  const schema = z.object({
    setNumber: z.string().nonempty({ message: "setNumber is required" }),
    title: z.string().nonempty({ message: "title is required" }),
    description: z.string().optional(),
    theme: z.string().nonempty({ message: "theme is required" }),
    ageRecommendation: z.string().nonempty({ message: "ageRecommendation is required" }),
    pieceCount: z.number().int().positive({ message: "pieceCount must be a positive integer" }),
    condition: z.nativeEnum(ListingCondition),
    originalPrice: z.number().positive({ message: "originalPrice must be positive" }),
    salePrice: z.number().nonnegative().optional(),
    currentStock: z.number().int().nonnegative().optional(),
  });

  const parseResult = schema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }
  const {
    setNumber,
    title,
    description,
    theme,
    ageRecommendation,
    pieceCount,
    condition,
    originalPrice,
    salePrice,
    currentStock,
  } = parseResult.data;

  try {
    // Atomic nested create of product listing and associated LegoProduct
    const listing = await prisma.productListing.create({
      data: {
        condition,
        originalPrice,
        salePrice,
        currentStock: currentStock ?? 0,
        legoProduct: {
          create: {
            setNumber,
            title,
            description,
            theme,
            ageRecommendation,
            pieceCount,
          },
        },
      },
    });

    const result = await prisma.productListing.findUnique({
      where: { id: listing.id },
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
    res.status(201).json(result);
  } catch (err) {
    console.error("Create product error", err);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "setNumber already exists" });
    }
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
