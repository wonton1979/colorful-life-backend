/**
 * Normalisation logic for raw purchase documents.
 *
 * This file contains pure helper functions for parsing dates, money and
 * optional integer values, and a public `normalizePurchaseDocument` function
 * that converts a `SourcePurchaseDocument` into a `NormalizedPurchaseDocument`
 * compatible with the cost‑allocation engine.
 *
 * The implementation deliberately focuses on the three behaviours required
 * by the unit tests:
 *   1. Optional dates must throw on invalid values.
 *   2. ISO dates are semantically validated.
 *   3. Only an optional leading £ symbol is accepted for money values.
 */

import {
  NormalizedPurchaseDocument,
  NormalizedPurchaseItem,
} from "./purchaseImport.js";

/**
 * Error thrown when source data cannot be parsed into the domain contract.
 */
export class PurchaseNormalizationError extends Error {
  constructor(message: string) {
    super(`PurchaseNormalizationError: ${message}`);
    this.name = "PurchaseNormalizationError";
  }
}

/**
 * Raw source contract.
 */
export interface SourcePurchaseDocument {
  importHash: string;
  sourceOrderReference: string;
  sourceOrderDate?: string;
  merchantName?: string;
  sourceInvoiceReference?: string;
  sourceDocumentDate?: string;
  originalGrossMerchandiseTotal: string | number;
  shippingTotal?: string | number;
  discountTotal?: string | number;
  finalTotalPaid: string | number;
  items: SourcePurchaseItem[];
}

export interface SourcePurchaseItem {
  sourceLineNumber?: string | number;
  externalProductId?: string;
  sourceDescription: string;
  sourceSetNumber?: string;
  productListingId?: string | number;
  quantity: string | number;
  originalGrossUnitCost: string | number;
  originalGrossLineTotal: string | number;
}

/**
 * Convert a source document into a normalised contract.
 */
export function normalizePurchaseDocument(
  src: SourcePurchaseDocument,
): NormalizedPurchaseDocument {
  const requiredString = (
    value: unknown,
    name: string,
  ): string => {
    if (typeof value !== "string") {
      throw new PurchaseNormalizationError(`${name} must be a string`);
    }
    const trimmed = value.trim();
    if (trimmed === "") {
      throw new PurchaseNormalizationError(`${name} is required and cannot be blank`);
    }
    return trimmed;
  };

  const optionalString = (
    value: unknown,
    name: string,
  ): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") {
      throw new PurchaseNormalizationError(`${name} must be a string if provided`);
    }
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  };

  const requiredNumber = (
    value: unknown,
    name: string,
  ): number => {
    if (typeof value !== "number" && typeof value !== "string") {
      throw new PurchaseNormalizationError(`${name} must be number or string`);
    }
    const parsed = parseMoney(value);
    if (parsed < 0) {
      throw new PurchaseNormalizationError(`${name} must be non‑negative`);
    }
    return parsed;
  };

  const optionalNumber = (
    value: unknown,
    name: string,
  ): number | undefined => {
    if (value === undefined || value === null) return undefined;
    const parsed = parseMoney(value);
    if (parsed < 0) {
      throw new PurchaseNormalizationError(`${name} must be non‑negative`);
    }
    return parsed;
  };

  const requiredQuantity = (
    value: unknown,
    name: string,
  ): number => {
    if (typeof value !== "number" && typeof value !== "string") {
      throw new PurchaseNormalizationError(`${name} must be number or string`);
    }
    const parsed = parseQuantity(value);
    if (parsed <= 0) {
      throw new PurchaseNormalizationError(`${name} must be a positive integer`);
    }
    return parsed;
  };

  const optionalPositiveInteger = (
    value: unknown,
    name: string,
  ): number | undefined => {
    if (value === undefined || value === null) return undefined;
    const parsed = parsePositiveInteger(value);
    if (parsed <= 0) {
      throw new PurchaseNormalizationError(`${name} must be a positive integer`);
    }
    return parsed;
  };

  const requiredDate = (value: unknown, name: string): string => {
    if (value === undefined || value === null) {
      throw new PurchaseNormalizationError(`${name} is required`);
    }
    if (typeof value !== "string") {
      throw new PurchaseNormalizationError(`${name} must be a string`);
    }
    const parsed = parseDate(value);
    if (!parsed) {
      throw new PurchaseNormalizationError(`Invalid date for ${name}`);
    }
    return parsed;
  };

  const optionalDate = (value: unknown, name: string): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") {
      throw new PurchaseNormalizationError(`${name} must be a string`);
    }
    const parsed = parseDate(value);
    if (!parsed) {
      throw new PurchaseNormalizationError(`Invalid date for ${name}`);
    }
    return parsed;
  };

  // Root fields
  const importHash = requiredString(src.importHash, "importHash");
  const sourceOrderReference = requiredString(
    src.sourceOrderReference,
    "sourceOrderReference",
  );
  const finalTotalPaid = requiredNumber(src.finalTotalPaid, "finalTotalPaid");
  const originalGrossMerchandiseTotal = requiredNumber(
    src.originalGrossMerchandiseTotal,
    "originalGrossMerchandiseTotal",
  );
  const shippingTotal = optionalNumber(src.shippingTotal, "shippingTotal") ?? 0;
  const discountTotal = optionalNumber(src.discountTotal, "discountTotal") ?? 0;
  const sourceOrderDate = optionalDate(src.sourceOrderDate, "sourceOrderDate");
  const sourceDocumentDate = optionalDate(
    src.sourceDocumentDate,
    "sourceDocumentDate",
  );
  const merchantName = optionalString(src.merchantName, "merchantName");
  const sourceInvoiceReference = optionalString(
    src.sourceInvoiceReference,
    "sourceInvoiceReference",
  );

  if (!Array.isArray(src.items) || src.items.length === 0) {
    throw new PurchaseNormalizationError("items must be a non‑empty array");
  }

  const items: NormalizedPurchaseItem[] = src.items.map((it, idx) => {
    const sourceDescription = requiredString(
      it.sourceDescription,
      `items[${idx}].sourceDescription`,
    );
    const quantity = requiredQuantity(it.quantity, `items[${idx}].quantity`);
    const originalGrossUnitCost = requiredNumber(
      it.originalGrossUnitCost,
      `items[${idx}].originalGrossUnitCost`,
    );
    const originalGrossLineTotal = requiredNumber(
      it.originalGrossLineTotal,
      `items[${idx}].originalGrossLineTotal`,
    );
    const sourceLineNumber = optionalPositiveInteger(
      it.sourceLineNumber,
      `items[${idx}].sourceLineNumber`,
    );
    const productListingId = optionalPositiveInteger(
      it.productListingId,
      `items[${idx}].productListingId`,
    );
    const externalProductId = optionalString(
      it.externalProductId,
      `items[${idx}].externalProductId`,
    );
    const sourceSetNumber = optionalString(
      it.sourceSetNumber,
      `items[${idx}].sourceSetNumber`,
    );
    return {
      sourceDescription,
      quantity,
      originalGrossUnitCost,
      originalGrossLineTotal,
      sourceLineNumber,
      productListingId,
      externalProductId,
      sourceSetNumber,
    };
  });

  return {
    importHash,
    sourceOrderReference,
    originalGrossMerchandiseTotal,
    shippingTotal,
    discountTotal,
    finalTotalPaid,
    items,
    sourceOrderDate,
    sourceDocumentDate,
    merchantName,
    sourceInvoiceReference,
  };
}

/**
 * Parse a money string into pennies.
 *
 * Accepts an optional leading £ symbol.  No other prefixes are allowed.
 *
 * Examples:
 *  - "£37.04" → 3704
 *  - "37.04"  → 3704
 *  - "37"     → 3700
 */
function parseMoney(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new PurchaseNormalizationError(`Money value must be number or string, got ${typeof value}`);
  }
  let str: string;
  if (typeof value === "number") {
    str = value.toString();
  } else {
    str = value.trim();
  }
  if (str === "") {
    throw new PurchaseNormalizationError(`Money value cannot be empty`);
  }
  // Only allow an optional leading £
  if (str.startsWith("£")) {
    str = str.slice(1);
  } else if (!/^[\d]/.test(str)) {
    throw new PurchaseNormalizationError(`Invalid money format: "${value}"`);
  }
  // Validate numeric format
  const match = /^\d+(?:\.(\d{1,2}))?$/.exec(str);
  if (!match) {
    throw new PurchaseNormalizationError(`Invalid money format: "${value}"`);
  }
  const whole = parseInt(match[0].split(".")[0], 10);
  const fracPart = match[1] ? match[1].padEnd(2, "0") : "00";
  const pennies = whole * 100 + parseInt(fracPart, 10);
  if (!Number.isSafeInteger(pennies)) {
    throw new PurchaseNormalizationError(`Money value out of safe integer range: ${value}`);
  }
  return pennies;
}

/**
 * Parse quantity string into a positive integer.
 */
function parseQuantity(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new PurchaseNormalizationError(`Quantity must be number or string, got ${typeof value}`);
  }
  let str: string;
  if (typeof value === "number") {
    str = value.toString();
  } else {
    str = value.trim();
  }
  if (str === "") {
    throw new PurchaseNormalizationError(`Quantity cannot be empty`);
  }
  const match = /^\d+$/.exec(str);
  if (!match) {
    throw new PurchaseNormalizationError(`Invalid quantity: "${value}"`);
  }
  const qty = parseInt(match[0], 10);
  if (!Number.isSafeInteger(qty)) {
    throw new PurchaseNormalizationError(`Quantity out of safe integer range: ${value}`);
  }
  return qty;
}

/**
 * Parse a positive integer (e.g., IDs, line numbers).
 */
function parsePositiveInteger(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new PurchaseNormalizationError(`Expected number or string, got ${typeof value}`);
  }
  let str: string;
  if (typeof value === "number") {
    str = value.toString();
  } else {
    str = value.trim();
  }
  if (str === "") {
    throw new PurchaseNormalizationError(`Value cannot be empty`);
  }
  const match = /^\d+$/.exec(str);
  if (!match) {
    throw new PurchaseNormalizationError(`Invalid integer: "${value}"`);
  }
  const num = parseInt(match[0], 10);
  if (!Number.isSafeInteger(num)) {
    throw new PurchaseNormalizationError(`Integer out of safe integer range: ${value}`);
  }
  return num;
}

/**
 * Parse a date string into an ISO 2026‑01‑31 format.
 * Supports ISO strings and "DD MMM YYYY" (e.g., "17 Aug 2026").
 * Validates that the date components form a real calendar date.
 */
function parseDate(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  // ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [yearStr, monthStr, dayStr] = trimmed.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10) - 1; // 0‑based
    const day = parseInt(dayStr, 10);
    const date = new Date(Date.UTC(year, month, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month ||
      date.getUTCDate() !== day
    ) {
      return undefined;
    }
    return trimmed;
  }
  // DD MMM YYYY format
  const parts = trimmed.split(" ");
  if (parts.length === 3) {
    const [dayStr, monthAbbrev, yearStr] = parts;
    const day = parseInt(dayStr, 10);
    const year = parseInt(yearStr, 10);
    const monthMap: Record<string, number> = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11,
    };
    const month = monthMap[monthAbbrev];
    if (month === undefined) return undefined;
    if (Number.isNaN(day) || Number.isNaN(year)) return undefined;
    const date = new Date(Date.UTC(year, month, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month ||
      date.getUTCDate() !== day
    ) {
      return undefined;
    }
    return date.toISOString().slice(0, 10);
  }
  return undefined;
}
