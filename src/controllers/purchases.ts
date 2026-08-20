import { Request, Response } from "express";
import { createHash } from "node:crypto";
import { importAmazonPurchaseInvoice } from "../domain/purchases/purchaseImportService.js";
import { DuplicateImportError } from "../domain/purchases/purchasePersistence.js";
import { PdfTextExtractionError } from "../domain/purchases/pdfTextExtractor.js";
import { AmazonPurchaseInvoiceParseError } from "../domain/purchases/parsers/amazonPurchaseInvoiceParser.js";
import { PurchaseNormalizationError } from "../domain/purchases/purchaseNormalizer.js";
import { ValidationError } from "../domain/purchases/purchaseImport.js";

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
