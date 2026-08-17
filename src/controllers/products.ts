import { Request, Response } from "express";
import { Prisma } from "../generated/prisma-client/client.js";
import { ListingCondition } from "../generated/prisma-client/enums.js";
import { prisma } from "../prisma/runtime.js";
import { z } from "zod";

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
 * PATCH /products/:id
 * Partially updates a product listing and its associated LegoProduct.
 * Supports updates to the following fields:
 *   - LegoProduct: setNumber, title, description, theme, ageRecommendation, pieceCount
 *   - ProductListing: condition, originalPrice, salePrice, currentStock
 * Non‑updatable fields (IDs, timestamps, active flag, etc.) are ignored.
 */
export const updateProduct = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(404).json({ error: "Listing not found" });
  }

  // Define partial schema for validation
  const updateSchema = z
    .object({
      setNumber: z.string().nonempty({ message: "setNumber cannot be empty" }),
      title: z.string().nonempty({ message: "title cannot be empty" }),
      description: z.string().optional(),
      theme: z.string().nonempty({ message: "theme cannot be empty" }),
      ageRecommendation: z
        .string()
        .nonempty({ message: "ageRecommendation cannot be empty" }),
      pieceCount: z.number().int().positive({ message: "pieceCount must be a positive integer" }),
      condition: z.nativeEnum(ListingCondition),
      originalPrice: z.number().positive({ message: "originalPrice must be positive" }),
      salePrice: z.number().nonnegative().optional(),
      currentStock: z.number().int().nonnegative().optional(),
    })
    .partial();

  const parseResult = updateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }

  const body = parseResult.data;
  if (Object.keys(body).length === 0) {
    return res.status(400).json({ error: "No updatable fields provided" });
  }

  const listingData: any = {};
  const legoUpdate: any = {};

  // Map ProductListing fields
  if (body.condition !== undefined) listingData.condition = body.condition;
  if (body.originalPrice !== undefined) listingData.originalPrice = body.originalPrice;
  if (body.salePrice !== undefined) listingData.salePrice = body.salePrice;
  if (body.currentStock !== undefined) listingData.currentStock = body.currentStock;

  // Map LegoProduct fields
  const legoFields = [
    "setNumber",
    "title",
    "description",
    "theme",
    "ageRecommendation",
    "pieceCount",
  ] as const;
  legoFields.forEach((field) => {
    if (body[field] !== undefined) {
      legoUpdate[field] = body[field];
    }
  });
  if (Object.keys(legoUpdate).length > 0) {
    listingData.legoProduct = { update: legoUpdate };
  }

  try {
    // Verify existence
    const existing = await prisma.productListing.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Listing not found" });
    }
    // Perform atomic nested update
    await prisma.productListing.update({ where: { id }, data: listingData });
    // Return the updated listing
    const updated = await prisma.productListing.findUnique({
      where: { id },
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
        listingImages: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!updated) {
      return res.status(500).json({ error: "Failed to retrieve updated listing" });
    }
    res.json(updated);
  } catch (err) {
    console.error("Update product error", err);
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

/**
 * PATCH /products/:id/deactivate
 * Deactivates a product listing without deleting data.
 */
export const deactivateProduct = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(404).json({ error: "Listing not found" });
  }
  try {
    const existing = await prisma.productListing.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Listing not found" });
    }
    await prisma.productListing.update({ where: { id }, data: { active: false } });
    const updated = await prisma.productListing.findUnique({
      where: { id },
      select: {
        id: true,
        legoProductId: true,
        condition: true,
        originalPrice: true,
        salePrice: true,
        active: true,
        currentStock: true,
        createdAt: true,
        updatedAt: true,
        legoProduct: true,
        listingImages: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!updated) {
      return res.status(500).json({ error: "Failed to retrieve updated listing" });
    }
    res.json(updated);
  } catch (err) {
    console.error("Deactivate product error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PATCH /products/:id/reactivate
 * Reactivates a product listing without deleting data.
 */
export const reactivateProduct = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(404).json({ error: "Listing not found" });
  }
  try {
    const existing = await prisma.productListing.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Listing not found" });
    }
    await prisma.productListing.update({ where: { id }, data: { active: true } });
    const updated = await prisma.productListing.findUnique({
      where: { id },
      select: {
        id: true,
        legoProductId: true,
        condition: true,
        originalPrice: true,
        salePrice: true,
        active: true,
        currentStock: true,
        createdAt: true,
        updatedAt: true,
        legoProduct: true,
        listingImages: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!updated) {
      return res.status(500).json({ error: "Failed to retrieve updated listing" });
    }
    res.json(updated);
  } catch (err) {
    console.error("Reactivate product error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
