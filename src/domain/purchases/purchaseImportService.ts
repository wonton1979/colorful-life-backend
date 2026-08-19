import { extractPdfText } from "./pdfTextExtractor.js";
import { parseAmazonPurchaseInvoice } from "./parsers/amazonPurchaseInvoiceParser.js";
import { normalizePurchaseDocument } from "./purchaseNormalizer.js";
import { calculatePurchaseCosts } from "./purchaseImport.js";
import { persistCalculatedPurchaseDocument } from "./purchasePersistence.js";
import type { NormalizedPurchaseDocument } from "./purchaseImport.js";

/**
 * Import an Amazon UK purchase invoice from a PDF file.
 *
 * The import process is intentionally pure from a business‑logic perspective
 * – it extracts, parses, normalises, calculates costs and persists the
 * resulting document.  All errors are propagated to the caller so that
 * higher‑level layers can decide how to report failures.
 *
 * @param pdfBytes   Raw PDF bytes.
 * @param importHash Unique hash of the PDF (typically SHA‑256).
 * @param userId     ID of the authenticated user performing the import.
 * @throws AmazonPurchaseInvoiceParseError if the PDF cannot be parsed.
 * @throws PurchaseNormalizationError    if the parsed data is invalid.
 * @throws ValidationError                if calculated costs are inconsistent.
 * @throws DuplicateImportError           if the same hash has already been processed.
 */
export async function importAmazonPurchaseInvoice(
  pdfBytes: Uint8Array,
  importHash: string,
  userId: number,
): Promise<void> {
  // 1️⃣  Extract raw text from the PDF
  const extractedPdf = await extractPdfText(pdfBytes);

  // 2️⃣  Parse the Amazon invoice into a source contract
  const source = parseAmazonPurchaseInvoice(extractedPdf, importHash);

  // 3️⃣  Normalise the source data into the domain contract
  const normalised: NormalizedPurchaseDocument = normalizePurchaseDocument(source);

  // 4️⃣  Allocate shipping/discount and validate totals
  const calculated = calculatePurchaseCosts(normalised);

  // 5️⃣  Persist the calculated document, handling duplicates
  await persistCalculatedPurchaseDocument(calculated, userId);
}
