import { prisma } from "../../prisma/runtime.js";
import type { CalculatedPurchaseDocument } from "./purchaseImport.js";

/**
 * Error thrown when attempting to import a purchase document that has already
 * been processed.  The database enforces a unique constraint on
 * `PurchaseDocument.importHash`; this error provides a clear domain‑level
 * signal to callers.
 */
export class DuplicateImportError extends Error {
  constructor(importHash: string) {
    super(`Duplicate import hash: ${importHash}`);
    this.name = "DuplicateImportError";
  }
}

/**
 * Convert a monetary value represented in pennies (integer) to a string that
 * Prisma can consume as a Decimal.  The function guarantees two decimal
 * places regardless of sign.
 */
function penniesToDecimal(pennies: number): string {
  const sign = pennies < 0 ? "-" : "";
  const abs = Math.abs(pennies);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sign}${whole}.${cents.toString().padStart(2, "0")}`;
}

/**
 * Persist a fully calculated purchase document, including the purchase
 * record, document, and all line items.  The operation is wrapped in a
 * single Prisma transaction so that either all changes are committed or
 * none are.
 *
 * @param doc   The calculated purchase document to persist.
 * @param userId The ID of the authenticated user performing the import.
 */
export async function persistCalculatedPurchaseDocument(
  doc: CalculatedPurchaseDocument,
  userId: number,
): Promise<void> {
  // Wrap the entire workflow in a transaction.  Any error causes a rollback.
  try {
    await prisma.$transaction(async (tx) => {
      /*
       * 1️⃣  Purchase – create if it does not already exist.
       *    We use upsert to avoid an extra lookup; the update payload is
       *    intentionally empty because we only care about the existence.
       */
      const purchase = await tx.purchase.upsert({
        where: { sourceOrderReference: doc.sourceOrderReference },
        update: {},
        create: {
          sourceOrderReference: doc.sourceOrderReference,
          sourceOrderDate: doc.sourceOrderDate
            ? new Date(doc.sourceOrderDate)
            : null,
          merchantName: doc.merchantName ?? null,
        },
      });

      /*
       * 2️⃣  PurchaseDocument – determine partNumber.
       *    partNumber is the next ordinal within the purchase.  If there are
       *    no existing documents we start at 1.
       */
      const lastDoc = await tx.purchaseDocument.findFirst({
        where: { purchaseId: purchase.id },
        orderBy: { partNumber: "desc" },
        select: { partNumber: true },
      });
      const partNumber = lastDoc ? lastDoc.partNumber + 1 : 1;

      const purchaseDocument = await tx.purchaseDocument.create({
        data: {
          purchaseId: purchase.id,
          partNumber,
          sourceInvoiceReference: doc.sourceInvoiceReference ?? null,
          importHash: doc.importHash,
          sourceDocumentDate: doc.sourceDocumentDate
            ? new Date(doc.sourceDocumentDate)
            : null,
          importedByUserId: userId,
          originalGrossMerchandiseTotal: penniesToDecimal(
            doc.originalGrossMerchandiseTotal,
          ),
          shippingTotal: penniesToDecimal(doc.shippingTotal),
          discountTotal: penniesToDecimal(doc.discountTotal),
          finalTotalPaid: penniesToDecimal(doc.finalTotalPaid),
        },
      });

      /*
       * 3️⃣  PurchaseItem – create all line items.  We use `createMany`
       *    for efficiency; the `purchaseDocumentId` foreign key is added
       *    to each row.
       */
      const itemData = doc.items.map((item) => ({
        purchaseDocumentId: purchaseDocument.id,
        productListingId: item.productListingId ?? null,
        externalProductId: item.externalProductId ?? null,
        sourceDescription: item.sourceDescription,
        sourceSetNumber: item.sourceSetNumber ?? null,
        sourceLineNumber: item.sourceLineNumber ?? null,
        quantity: item.quantity,
        originalGrossUnitCost: penniesToDecimal(item.originalGrossUnitCost),
        originalGrossLineTotal: penniesToDecimal(item.originalGrossLineTotal),
        allocatedShipping: penniesToDecimal(item.allocatedShipping),
        allocatedDiscount: penniesToDecimal(item.allocatedDiscount),
        finalLineCost: penniesToDecimal(item.finalLineCost),
        finalUnitCost: item.finalUnitCost,
      }));

      await tx.purchaseItem.createMany({ data: itemData });
    });
  } catch (err: unknown) {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "P2002"
  ) {
    throw new DuplicateImportError(doc.importHash);
  }

  throw err;
}
}
