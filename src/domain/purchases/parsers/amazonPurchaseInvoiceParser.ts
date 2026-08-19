// Parser for Amazon UK purchase invoices.
//
// Implements deterministic extraction of a `SourcePurchaseDocument` from the raw
// text produced by `extractPdfText`.  The parser follows the contract
// described in the task and uses the `AmazonPurchaseInvoiceParseError` type for
// any structural failure.

import { ExtractedPdfText } from "../pdfTextExtractor.js";
import {
  SourcePurchaseDocument,
  SourcePurchaseItem,
} from "../purchaseNormalizer.js";

/**
 * Error type used when the invoice text cannot be parsed.
 */
export class AmazonPurchaseInvoiceParseError extends Error {
  constructor(message: string) {
    super(`AmazonPurchaseInvoiceParseError: ${message}`);
    this.name = "AmazonPurchaseInvoiceParseError";
  }
}

/**
 * Convert dates with full month names into the abbreviated form expected by
 * the normaliser (e.g. "09 August 2026" -> "09 Aug 2026").
 */
const normalizeMonthName = (date: string): string => {
  const parts = date.trim().split(" ");
  if (parts.length !== 3) return date;
  const [day, monthFull, year] = parts;
  const monthMap: Record<string, string> = {
    Jan: "Jan",
    Feb: "Feb",
    Mar: "Mar",
    Apr: "Apr",
    May: "May",
    Jun: "Jun",
    Jul: "Jul",
    Aug: "Aug",
    Sep: "Sep",
    Oct: "Oct",
    Nov: "Nov",
    Dec: "Dec",
    January: "Jan",
    February: "Feb",
    March: "Mar",
    April: "Apr",
    June: "Jun",
    July: "Jul",
    August: "Aug",
    September: "Sep",
    October: "Oct",
    November: "Nov",
    December: "Dec",
  };
  const monthAbbrev = monthMap[monthFull];
  return monthAbbrev ? `${day} ${monthAbbrev} ${year}` : date;
};

/**
 * Parse an Amazon UK invoice into a `SourcePurchaseDocument`.
 * @param extractedPdf The result of `extractPdfText`.
 * @param importHash   Hash identifying the import.
 */
export function parseAmazonPurchaseInvoice(
  extractedPdf: ExtractedPdfText,
  importHash: string,
): SourcePurchaseDocument {
  // --- Regex patterns -----------------------------------------------------
  const orderRefRe = /^Order # (.+)$/i;
  const orderDateRe = /^Order date (.+)$/i;
  const merchantRe = /^Sold by (.+)$/i;
  const invoiceRefRe = /^Invoice # (.+)$/i;
  const invoiceDateRe = /^Invoice date \/ Delivery date (.+)$/i;
  const finalTotalRe = /^Invoice total £([\d\.]+)$/i;
  const shippingRe = /^Shipping Charges.*£([\d\.]+).*£([\d\.]+).*£([\d\.]+)/i;
  const promotionsRe = /^Promotions.*£([\d\.]+).*£([\d\.]+).*£(-?[\d\.]+)/i;
  // Table header is multi‑line – detect only the first line.
  const tableHeaderFirstLineRe = /^Description\s+Qty\s+Unit price/i;
  const asinRe = /^ASIN:\s*(\S+)/i;
  const priceRowRe = /^\s*(\d+)\s+£([\d\.]+)\s+(\d+%)\s+£([\d\.]+)\s+£([\d\.]+)/i;
  const footerRe = /^(Shipping Charges|Promotions|Invoice total|VAT included|Thank you|Total for your order)/i;

  // --- Accumulators ------------------------------------------------------
  let sourceOrderReference: string | undefined;
  let sourceOrderDate: string | undefined;
  let merchantName: string | undefined;
  let sourceInvoiceReference: string | undefined;
  let sourceDocumentDate: string | undefined;
  let finalTotalPaid: string | undefined;
  let shippingTotal: string | undefined;
  let discountTotal: string | undefined;
  const items: SourcePurchaseItem[] = [];

  // --- Pending item across page boundaries ------------------------------
  interface Pending {
    descriptionLines: string[];
    asin?: string;
    quantity?: number;
    unitPrice?: string;
    lineTotal?: string;
  }
  let pending: Pending | null = null;

  const finalizeItem = (): void => {
    if (!pending) return;
    if (!pending.asin) {
      throw new AmazonPurchaseInvoiceParseError("Item missing ASIN");
    }
    if (!pending.quantity || !pending.unitPrice || !pending.lineTotal) {
      throw new AmazonPurchaseInvoiceParseError("Item missing price information");
    }
    const description = pending.descriptionLines.join(" ").trim();
    const setMatch = description.match(/-\s*(\d+)$/);
    const sourceSetNumber = setMatch ? setMatch[1] : undefined;
    items.push({
      sourceLineNumber: items.length + 1,
      externalProductId: pending.asin,
      sourceDescription: description,
      sourceSetNumber,
      quantity: pending.quantity,
      originalGrossUnitCost: pending.unitPrice,
      originalGrossLineTotal: pending.lineTotal,
    });
    pending = null;
  };

  // --- Main processing ---------------------------------------------------
  for (const page of extractedPdf.pages) {
    // Table state is page‑scoped – reset for each page.
    let state: "outside" | "inside" = "outside";
    let headerSkip = 0;
    const lines = page.text.split(/\r?\n/).map((l) => l.trim());
    for (const rawLine of lines) {
      if (!rawLine) continue;
      const line = rawLine;

      // Global markers – collect regardless of table state.
      if (!sourceOrderReference) {
        const m = line.match(orderRefRe);
        if (m) sourceOrderReference = m[1].trim();
      }
      if (!sourceOrderDate) {
        const m = line.match(orderDateRe);
        if (m) sourceOrderDate = normalizeMonthName(m[1].trim());
      }
      if (!merchantName) {
        const m = line.match(merchantRe);
        if (m) merchantName = m[1].trim();
      }
      if (!sourceInvoiceReference) {
        const m = line.match(invoiceRefRe);
        if (m) sourceInvoiceReference = m[1].trim();
      }
      if (!sourceDocumentDate) {
        const m = line.match(invoiceDateRe);
        if (m) sourceDocumentDate = normalizeMonthName(m[1].trim());
      }
      if (!finalTotalPaid) {
        const m = line.match(finalTotalRe);
        if (m) finalTotalPaid = m[1].trim();
      }
      if (!shippingTotal) {
        const m = line.match(shippingRe);
        if (m) shippingTotal = m[3].trim();
      }
      if (!discountTotal) {
        const m = line.match(promotionsRe);
        if (m) {
          const val = m[3].trim();
          discountTotal = val.startsWith("-") ? val.substring(1) : val;
        }
      }

      // Table state machine
      if (state === "outside") {
        if (tableHeaderFirstLineRe.test(line)) {
          state = "inside";
          headerSkip = 5; // skip the following five header lines
          continue;
        }
        continue; // ignore everything else
      }

      // Inside table – handle header skip
      if (headerSkip > 0) {
        headerSkip--;
        continue;
      }

      // Detect footer that ends the table
      if (footerRe.test(line)) {
        if (pending) {
          throw new AmazonPurchaseInvoiceParseError("Incomplete item before table end");
        }
        state = "outside";
        continue;
      }

      // Begin or continue an item
      if (!pending) pending = { descriptionLines: [] };

      const asinMatch = line.match(asinRe);
      if (asinMatch) {
        pending.asin = asinMatch[1].trim();
        if (pending.quantity && pending.unitPrice && pending.lineTotal) finalizeItem();
        continue;
      }

      const priceMatch = line.match(priceRowRe);
      if (priceMatch) {
        pending.quantity = parseInt(priceMatch[1], 10);
        pending.unitPrice = priceMatch[4].trim();
        pending.lineTotal = priceMatch[5].trim();
        if (pending.asin) finalizeItem();
        continue;
      }

      // Otherwise treat as part of description
      pending.descriptionLines.push(line);
    }
    // End of page – pending item persists for next page
  }

  // Final validation
  if (pending) {
    throw new AmazonPurchaseInvoiceParseError("Incomplete item at end of document");
  }
  if (!sourceOrderReference) {
    throw new AmazonPurchaseInvoiceParseError("Missing source order reference");
  }
  if (!finalTotalPaid) {
    throw new AmazonPurchaseInvoiceParseError("Missing final total paid");
  }
  if (items.length === 0) {
    throw new AmazonPurchaseInvoiceParseError("No items parsed");
  }

  // Compute merchandise total from line totals
  const sumPennies = items.reduce((acc, it) => {
    const amt = Math.round(parseFloat(it.originalGrossLineTotal as string) * 100);
    return acc + amt;
  }, 0);
  const originalGrossMerchandiseTotal = (sumPennies / 100).toFixed(2);

  const doc: SourcePurchaseDocument = {
    importHash,
    sourceOrderReference,
    sourceOrderDate,
    merchantName,
    sourceInvoiceReference,
    sourceDocumentDate,
    originalGrossMerchandiseTotal,
    finalTotalPaid,
    items,
  };
  if (shippingTotal !== undefined) doc.shippingTotal = shippingTotal;
  if (discountTotal !== undefined) doc.discountTotal = discountTotal;
  return doc;
}
