import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma/runtime.js";
import { calculatePurchaseCosts } from "./purchaseImport.js";
import { persistCalculatedPurchaseDocument } from "./purchasePersistence.js";
import type { NormalizedPurchaseDocument } from "./purchaseImport.js";
import type { ManualPurchaseInput } from "./manualPurchaseValidator.js";

/**
 * Domain error raised when an explicit productListingId is supplied but no
 * matching record exists.
 */
export class ProductListingNotFoundError extends Error {
  constructor(productListingId: number) {
    super(`No ProductListing found with id ${productListingId}`);
    this.name = "ProductListingNotFoundError";
  }
}

/**
 * Create a purchase record from a manually entered purchase document.
 *
 * The function performs the following steps:
 * 1. Validates that any supplied `productListingId` exists.
 * 2. Normalises the input into the internal `NormalizedPurchaseDocument`
 *    contract used by the cost‑allocation engine.
 * 3. Generates a unique `importHash` of the form `manual:<UUID>`.
 * 4. Runs the cost‑allocation engine to compute per‑item line totals.
 * 5. Persists the result via `persistCalculatedPurchaseDocument`.
 * 6. Returns the persisted `PurchaseDocument` including related Purchase
 *    and PurchaseItems for the controller to format the response.
 */
export async function createManualPurchase(
  input: ManualPurchaseInput,
  userId: number,
): Promise<Awaited<ReturnType<typeof prisma.purchaseDocument.findUnique>>> {
  // 1️⃣  Verify explicit productListingId if present
   if (input.items.some((i) => i.productListingId !== undefined)) {
     // Gather all explicitly supplied productListingIds
     const suppliedIds = input.items
       .map((i) => i.productListingId)
       .filter((x): x is number => typeof x === "number");
     // Deduplicate
     const listingIds = Array.from(new Set(suppliedIds));
    if (listingIds.length > 0) {
      const existing = await prisma.productListing.findMany({
        where: { id: { in: listingIds } },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((l) => l.id));
      const missing = listingIds.filter((id) => !existingIds.has(id));
      if (missing.length > 0) {
        throw new ProductListingNotFoundError(missing[0]);
      }
    }
  }

  // 2️⃣  Normalise the source data – dates are converted to Date objects
  const normalized: NormalizedPurchaseDocument = {
    importHash: `manual:${randomUUID()}`,
    sourceOrderReference: input.sourceOrderReference,
    sourceOrderDate: input.sourceOrderDate,
    merchantName: input.merchantName,
    sourceInvoiceReference: input.sourceInvoiceReference,
    sourceDocumentDate: input.sourceDocumentDate,
    originalGrossMerchandiseTotal: input.originalGrossMerchandiseTotal,
    shippingTotal: input.shippingTotal ?? 0,
    discountTotal: input.discountTotal ?? 0,
    finalTotalPaid: input.finalTotalPaid,
    items: input.items.map((i) => ({
      sourceLineNumber: i.sourceLineNumber,
      externalProductId: i.externalProductId,
      sourceDescription: i.sourceDescription,
      sourceSetNumber: i.sourceSetNumber,
      productListingId: i.productListingId,
      quantity: i.quantity,
      originalGrossUnitCost: i.originalGrossUnitCost,
      originalGrossLineTotal: i.originalGrossLineTotal,
    })),
  };

  // 3️⃣  Allocate costs – this validates totals and calculates final line totals
  const calculated = calculatePurchaseCosts(normalized);

  // 4️⃣  Persist – the persistence layer will handle matching product listings
  await persistCalculatedPurchaseDocument(calculated, userId);

  // 5️⃣  Retrieve the persisted document for response payload
  const purchaseDocument = await prisma.purchaseDocument.findUnique({
    where: { importHash: normalized.importHash },
    include: { purchase: true, purchaseItems: true },
  });

  if (!purchaseDocument) {
    // This should never happen – the persistence step just created it.
    throw new Error("Failed to retrieve persisted PurchaseDocument");
  }
  return purchaseDocument;
}
