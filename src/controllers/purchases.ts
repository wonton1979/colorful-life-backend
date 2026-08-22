import { Request, Response } from "express";
import { createHash } from "node:crypto";
import { importAmazonPurchaseInvoice } from "../domain/purchases/purchaseImportService.js";
import { DuplicateImportError } from "../domain/purchases/purchasePersistence.js";
import { PdfTextExtractionError } from "../domain/purchases/pdfTextExtractor.js";
import { AmazonPurchaseInvoiceParseError } from "../domain/purchases/parsers/amazonPurchaseInvoiceParser.js";
import { PurchaseNormalizationError } from "../domain/purchases/purchaseNormalizer.js";
import { ValidationError } from "../domain/purchases/purchaseImport.js";
import { prisma } from "../prisma/runtime.js";
// Domain service and error classes for purchase item receiving
import {
  receivePurchaseItem as domainReceivePurchaseItem,
  PurchaseItemNotFoundError,
  AlreadyReceivedError,
  InvalidQuantityError,
  ProductListingMissingError,
} from "../domain/purchases/purchaseItemReceiving.js";
// Domain service and error classes for purchase item return
import {
  returnPurchaseItem as domainReturnPurchaseItem,
  PurchaseItemNotFoundError as ReturnPurchaseItemNotFoundError,
  PurchaseItemNotReceivedError as ReturnPurchaseItemNotReceivedError,
  PurchaseItemAlreadyReturnedError as ReturnPurchaseItemAlreadyReturnedError,
  ProductListingMissingError as ReturnProductListingMissingError,
  InvalidQuantityError as ReturnInvalidQuantityError,
  InsufficientStockError as ReturnInsufficientStockError,
} from "../domain/purchases/purchaseItemReturn.js";

/**
 * Controller for the Purchase Invoice import endpoint.
 * Expects a single PDF file in the `file` field of a multipart/form‑data request.
 * The request must be authenticated via `authMiddleware`; the user ID is
 * available on `req.user.id`.
 */
export const importPurchaseInvoice = async (req: Request, res: Response) => {
  try {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ error: "No file provided" });
    }

    if (file.size === 0) {
      return res.status(400).json({ error: "Uploaded file is empty" });
    }

    // Simple PDF signature check – %PDF- is 5 bytes
    const pdfSignature = Buffer.from("%PDF-");
    if (!file.buffer.subarray(0, pdfSignature.length).equals(pdfSignature)) {
      return res.status(400).json({ error: "Uploaded file is not a valid PDF" });
    }

    const hash = createHash("sha256")
      .update(file.buffer)
      .digest("hex");

    const userId = (req.user as { id: number }).id;

    await importAmazonPurchaseInvoice(file.buffer, hash, userId);

    return res
      .status(201)
      .json({ message: "Purchase invoice imported successfully", importHash: hash });
  } catch (err: unknown) {
    if (err instanceof DuplicateImportError) {
      return res.status(409).json({ error: err.message });
    }
    if (
      err instanceof PdfTextExtractionError ||
      err instanceof AmazonPurchaseInvoiceParseError ||
      err instanceof PurchaseNormalizationError ||
      err instanceof ValidationError
    ) {
      return res.status(400).json({ error: err.message });
    }
    console.error("Purchase import error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * HTTP controller for receiving a purchase item.
 *
 * This controller validates the request, calls the domain service
 * `receivePurchaseItem(userId, purchaseItemId)`, and maps domain errors
 * to appropriate HTTP status codes.  It does not perform any business logic
 * beyond delegating to the domain service.
 */
export const receivePurchaseItem = async (req: Request, res: Response) => {
  const userId = (req.user as { id: number }).id;
  const idParam = req.params.id;
  const purchaseItemId = Number(idParam);
  if (!Number.isInteger(purchaseItemId) || purchaseItemId < 1) {
    return res.status(400).json({ error: "Invalid purchase item id" });
  }
  try {
    const result = await domainReceivePurchaseItem(userId, purchaseItemId);
    return res.status(200).json(result);
  } catch (err: unknown) {
    if (err instanceof PurchaseItemNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    if (err instanceof AlreadyReceivedError) {
      return res.status(409).json({ error: err.message });
    }
    if (err instanceof InvalidQuantityError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof ProductListingMissingError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("Receive purchase item error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * HTTP controller for returning a fully received purchase item.
 *
 * It delegates to the domain service {@link domainReturnPurchaseItem} and
 * maps domain errors to appropriate HTTP status codes.
 */
export const returnPurchaseItem = async (req: Request, res: Response) => {
  const authenticatedUserId = (req.user as { id: number }).id;
  const idParam = req.params.id;
  const purchaseItemId = Number(idParam);
  if (!Number.isInteger(purchaseItemId) || purchaseItemId < 1) {
    return res.status(400).json({ error: "Invalid purchase item id" });
  }
  try {
    const result = await domainReturnPurchaseItem(authenticatedUserId, purchaseItemId);
    return res.status(200).json(result);
  } catch (err: unknown) {
    // Map domain errors to HTTP status codes
    if (err instanceof ReturnPurchaseItemNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    if (err instanceof ReturnPurchaseItemNotReceivedError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof ReturnPurchaseItemAlreadyReturnedError) {
      return res.status(409).json({ error: err.message });
    }
    if (err instanceof ReturnProductListingMissingError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof ReturnInvalidQuantityError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof ReturnInsufficientStockError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("Return purchase item error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /purchases
 * Returns a paginated list of purchases that belong to the authenticated user.
 * Ownership is determined by presence of at least one PurchaseDocument
 * owned by the user.
 */
export const listPurchases = async (req: Request, res: Response) => {
  const userId = (req.user as { id: number }).id;
  const pageParam = req.query.page;
  const limitParam = req.query.limit;
  const page = Number(pageParam ?? 1);
  const limit = Number(limitParam ?? 20);
  if (!Number.isInteger(page) || page < 1) {
    return res.status(400).json({ error: "Invalid page parameter" });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ error: "Invalid limit parameter" });
  }
  try {
    const total = await prisma.purchase.count({
      where: {
        purchaseDocuments: {
          some: {
            importedByUserId: userId,
          },
        },
      },
    });
    const purchases = await prisma.purchase.findMany({
      where: {
        purchaseDocuments: {
          some: {
            importedByUserId: userId,
          },
        },
      },
      include: {
        purchaseDocuments: {
          where: { importedByUserId: userId },
        },
      },
      orderBy: [
        { sourceOrderDate: "desc" },
        { id: "desc" },
      ],
      skip: (page - 1) * limit,
      take: limit,
    });
    const totalPages = Math.ceil(total / limit);
    res.json({
      purchases,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (err) {
    console.error("List purchases error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /purchases/:id
 * Returns a single purchase belonging to the authenticated user, with
 * purchaseDocuments and purchaseItems filtered to the authenticated user.
 */
export const getPurchaseById = async (req: Request, res: Response) => {
  const userId = (req.user as { id: number }).id;
  const idParam = req.params.id;
  const purchaseId = Number(idParam);
  if (!Number.isInteger(purchaseId) || purchaseId < 1) {
    return res.status(400).json({ error: "Invalid purchase id" });
  }
  try {
    const purchase = await prisma.purchase.findFirst({
      where: {
        id: purchaseId,
        purchaseDocuments: {
          some: { importedByUserId: userId },
        },
      },
      include: {
        purchaseDocuments: {
          where: { importedByUserId: userId },
          orderBy: { partNumber: "asc" },
          include: {
            purchaseItems: {
              orderBy: { sourceLineNumber: "asc" },
            },
          },
        },
      },
    });
    if (!purchase) {
      return res.status(404).json({ error: "Purchase not found" });
    }
    res.json(purchase);
  } catch (err) {
    console.error("Get purchase error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
