/**
 * Domain logic for purchase import and cost allocation.
 *
 * This module intentionally contains **no** dependencies on Prisma, Express, or
 * any I/O.  It is a pure, deterministic implementation that can be unit‑
 * tested and later reused in a variety of import sources.
 *
 * Money is represented internally as *minor unit* integers (pence).  All
 * calculations are performed with `BigInt` to guarantee exactness, even for
 * products that could overflow the 53‑bit safe integer range.
 */

/**
 * Normalised purchase document after extraction/parsing but before persistence.
 *
 * All monetary values are expressed in pennies (integer).  The contract
 * intentionally omits database identifiers or timestamps.
 */
export interface NormalizedPurchaseDocument {
  /** A hash uniquely identifying the import source data. */
  importHash: string;
  /** Source order reference – required by the workflow and must be unique. */
  sourceOrderReference: string;
  /** Optional ISO date string of the source order. */
  sourceOrderDate?: string;
  /** Optional merchant name. */
  merchantName?: string;
  /** Optional source invoice reference. */
  sourceInvoiceReference?: string;
  /** Optional ISO date string of the source document. */
  sourceDocumentDate?: string;
  /** Gross merchandise total (shipping + discount not included). */
  originalGrossMerchandiseTotal: number; // pennies
  /** Shipping total, inclusive of VAT. */
  shippingTotal: number; // pennies
  /** Discount total, inclusive of VAT. */
  discountTotal: number; // pennies
  /** Final amount paid, inclusive of VAT, after shipping and discount. */
  finalTotalPaid: number; // pennies
  items: NormalizedPurchaseItem[];
}

export interface NormalizedPurchaseItem {
  /** Optional source line number – numeric as defined by the source system. */
  sourceLineNumber?: number;
  externalProductId?: string;
  sourceDescription: string;
  sourceSetNumber?: string;
  /** Optional ProductListing ID from the internal catalogue. */
  productListingId?: number;
  /** Quantity purchased – must be a positive integer. */
  quantity: number;
  /** Unit cost in pennies (gross / VAT‑inclusive). */
  originalGrossUnitCost: number; // pennies
  /** Gross line total in pennies (unit cost * quantity, possibly rounded). */
  originalGrossLineTotal: number; // pennies
}

/**
 * Result of the cost allocation engine.
 */
export interface CalculatedPurchaseDocument extends NormalizedPurchaseDocument {
  items: CalculatedPurchaseItem[];
}

export interface CalculatedPurchaseItem extends NormalizedPurchaseItem {
  /** Shipping amount allocated to this line (in pennies). */
  allocatedShipping: number;
  /** Discount amount allocated to this line (in pennies). */
  allocatedDiscount: number;
  /** Final line cost after shipping and discount (in pennies). */
  finalLineCost: number;
  /** Final unit cost – string with exactly 6 decimal places, e.g. "3.333333". */
  finalUnitCost: string;
}

/**
 * Domain specific error classes.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(`ValidationError: ${message}`);
    this.name = 'ValidationError';
  }
}

export class MerchandiseTotalMismatchError extends ValidationError {
  constructor(expected: number, actual: number) {
    super(`Merchandise total mismatch: expected ${expected} but got ${actual}`);
    this.name = 'MerchandiseTotalMismatchError';
  }
}

export class CostReconciliationFailedError extends ValidationError {
  constructor(message: string) {
    super(`CostReconciliationFailedError: ${message}`);
    this.name = 'CostReconciliationFailedError';
  }
}

/**
 * Allocate a total amount (shipping or discount) across a set of items
 * proportionally to each item's original gross line total.
 *
 * The algorithm uses the Largest Remainder Method to ensure the allocated
 * amounts sum exactly to the total while remaining deterministic.
 *
 * @param totalMerchandiseSum Sum of originalGrossLineTotal across all items.
 * @param totalAmount The total amount to allocate (shipping or discount).
 * @param items The array of items.
 * @returns An array of allocated pennies per item.
 */
function allocateProportional(
  totalMerchandiseSum: number,
  totalAmount: number,
  items: NormalizedPurchaseItem[],
): number[] {
  if (totalAmount === 0) return items.map(() => 0);
  if (totalMerchandiseSum === 0) {
    throw new ValidationError('Cannot allocate proportional amounts when merchandise total is zero');
  }
  const totalMerchandiseBig = BigInt(totalMerchandiseSum);
  const totalAmountBig = BigInt(totalAmount);
  const floors: number[] = new Array(items.length);
  const remainders: bigint[] = new Array(items.length);
  let sumFloors = 0;
  for (let i = 0; i < items.length; i++) {
    const lineTotal = items[i].originalGrossLineTotal;
    const product = BigInt(lineTotal) * totalAmountBig; // pennies * pennies
    const floor = product / totalMerchandiseBig; // BigInt division
    const remainder = product % totalMerchandiseBig;
    floors[i] = Number(floor); // floor is <= totalAmount
    remainders[i] = remainder;
    sumFloors += Number(floor);
  }
  const remaining = totalAmount - sumFloors; // pennies left to distribute
  if (remaining > 0) {
    const indices = items.map((_, idx) => idx);
    indices.sort((a, b) => {
      if (remainders[a] !== remainders[b]) {
        return remainders[a] > remainders[b] ? -1 : 1;
      }
      return a - b; // stable tie‑break by original order
    });
    for (let i = 0; i < remaining; i++) {
      floors[indices[i]] += 1;
    }
  }
  return floors;
}

/**
 * Main entry point for calculating purchase costs.
 *
 * @param doc Normalised purchase document.
 * @returns Calculated purchase document with per‑line allocations.
 */
export function calculatePurchaseCosts(
  doc: NormalizedPurchaseDocument,
): CalculatedPurchaseDocument {
  // ---------- Validation ----------
  if (!doc.importHash.trim()) {
    throw new ValidationError('importHash is required and cannot be empty');
  }
  if (!doc.sourceOrderReference.trim()) {
    throw new ValidationError('sourceOrderReference is required and cannot be empty');
  }
  if (!doc.items || doc.items.length === 0) {
    throw new ValidationError('Document must contain at least one item');
  }
  for (const [idx, item] of doc.items.entries()) {
    if (!item.sourceDescription.trim()) {
      throw new ValidationError(`Item ${idx} sourceDescription is required`);
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new ValidationError(`Item ${idx} has non‑positive integer quantity: ${item.quantity}`);
    }
    if (!Number.isSafeInteger(item.originalGrossUnitCost) || item.originalGrossUnitCost < 0) {
      throw new ValidationError(`Item ${idx} has invalid unit cost: ${item.originalGrossUnitCost}`);
    }
    if (!Number.isSafeInteger(item.originalGrossLineTotal) || item.originalGrossLineTotal < 0) {
      throw new ValidationError(`Item ${idx} has invalid line total: ${item.originalGrossLineTotal}`);
    }
  }
  const {
    originalGrossMerchandiseTotal,
    shippingTotal,
    discountTotal,
    finalTotalPaid,
  } = doc;
  if (!Number.isSafeInteger(originalGrossMerchandiseTotal) || originalGrossMerchandiseTotal < 0) {
    throw new ValidationError('originalGrossMerchandiseTotal must be a non‑negative integer');
  }
  if (!Number.isSafeInteger(shippingTotal) || shippingTotal < 0) {
    throw new ValidationError('shippingTotal must be a non‑negative integer');
  }
  if (!Number.isSafeInteger(discountTotal) || discountTotal < 0) {
    throw new ValidationError('discountTotal must be a non‑negative integer');
  }
  if (!Number.isSafeInteger(finalTotalPaid) || finalTotalPaid < 0) {
    throw new ValidationError('finalTotalPaid must be a non‑negative integer');
  }
  // Validate merchandise total match using BigInt for exactness
  const merchandiseSumBig = doc.items.reduce((sum, i) => sum + BigInt(i.originalGrossLineTotal), 0n);
  if (merchandiseSumBig !== BigInt(originalGrossMerchandiseTotal)) {
    throw new MerchandiseTotalMismatchError(originalGrossMerchandiseTotal, Number(merchandiseSumBig));
  }
  // Negative acquisition cost guard using BigInt
  const acquisitionBig = BigInt(originalGrossMerchandiseTotal) + BigInt(shippingTotal) - BigInt(discountTotal);
  if (acquisitionBig < 0n) {
    throw new ValidationError('Negative acquisition cost after applying shipping and discount');
  }

  const totalMerchandise = originalGrossMerchandiseTotal;
  const shippingAllocations = allocateProportional(
    totalMerchandise,
    shippingTotal,
    doc.items,
  );
  const discountAllocations = allocateProportional(
    totalMerchandise,
    discountTotal,
    doc.items,
  );

  const calculatedItems: CalculatedPurchaseItem[] = doc.items.map((item, idx) => {
    const shipping = shippingAllocations[idx];
    const discount = discountAllocations[idx];
    // Use BigInt for final line cost calculation to avoid overflow
    const finalLineCostBig = BigInt(item.originalGrossLineTotal) + BigInt(shipping) - BigInt(discount);
    if (finalLineCostBig < 0n) {
      throw new ValidationError(`Item ${idx} final line cost is negative: ${finalLineCostBig}`);
    }
    if (finalLineCostBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ValidationError(`Item ${idx} final line cost exceeds Number.MAX_SAFE_INTEGER`);
    }
    const finalLineCost = Number(finalLineCostBig);
    // Compute finalUnitCost as a string with 6 decimal places using integer math
    const numerator = BigInt(finalLineCost) * 10000n; // finalLineCost * 10_000
    const denominator = BigInt(item.quantity);
    const unitCostMillionths = (numerator + denominator / 2n) / denominator; // round to nearest
    const whole = unitCostMillionths / 1000000n;
    const fraction = unitCostMillionths % 1000000n;
    const finalUnitCost = `${whole}.${fraction.toString().padStart(6, '0')}`;
    return {
      ...item,
      allocatedShipping: shipping,
      allocatedDiscount: discount,
      finalLineCost,
      finalUnitCost,
    };
  });

  // ---------- Reconciliation ----------
  const finalLineCostSumBig = calculatedItems.reduce((sum, i) => sum + BigInt(i.finalLineCost), 0n);
  const expectedSumBig = BigInt(originalGrossMerchandiseTotal) + BigInt(shippingTotal) - BigInt(discountTotal);
  if (finalLineCostSumBig !== expectedSumBig) {
    throw new CostReconciliationFailedError(
      `Sum of final line costs (${finalLineCostSumBig.toString()}) does not equal expected (${expectedSumBig.toString()})`,
    );
  }
  if (finalLineCostSumBig !== BigInt(finalTotalPaid)) {
    throw new CostReconciliationFailedError(
      `Sum of final line costs (${finalLineCostSumBig.toString()}) does not match finalTotalPaid (${finalTotalPaid})`,
    );
  }

  return {
    ...doc,
    items: calculatedItems,
  };
}
