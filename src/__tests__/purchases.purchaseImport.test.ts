import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  calculatePurchaseCosts,
  NormalizedPurchaseDocument,
  MerchandiseTotalMismatchError,
  ValidationError,
  CostReconciliationFailedError,
} from "../domain/purchases/purchaseImport.js";

/** Helper to build a purchase document with sane defaults */
function makeDoc(overrides: Partial<NormalizedPurchaseDocument> = {}): NormalizedPurchaseDocument {
  const base: NormalizedPurchaseDocument = {
    importHash: "hash-123",
    sourceOrderReference: "SO-001",
    originalGrossMerchandiseTotal: 1000,
    shippingTotal: 200,
    discountTotal: 50,
    finalTotalPaid: 1150,
    items: [
      {
        sourceDescription: "Item A",
        quantity: 1,
        originalGrossUnitCost: 500,
        originalGrossLineTotal: 500,
      },
      {
        sourceDescription: "Item B",
        quantity: 1,
        originalGrossUnitCost: 500,
        originalGrossLineTotal: 500,
      },
    ],
  };
  return { ...base, ...overrides } as NormalizedPurchaseDocument;
}

describe("calculatePurchaseCosts", () => {
  it("allocates shipping and discount proportionally", () => {
    const result = calculatePurchaseCosts(makeDoc());
    const [a, b] = result.items;
    assert.equal(a.allocatedShipping, 100);
    assert.equal(b.allocatedShipping, 100);
    assert.equal(a.allocatedDiscount, 25);
    assert.equal(b.allocatedDiscount, 25);
    assert.equal(a.finalLineCost, 575);
    assert.equal(b.finalLineCost, 575);
    assert.equal(a.finalUnitCost, "5.750000");
  });

  it("largest‑remainder tie‑breaking is deterministic", () => {
    const doc: NormalizedPurchaseDocument = {
      importHash: "hash",
      sourceOrderReference: "ref",
      originalGrossMerchandiseTotal: 1000,
      shippingTotal: 100,
      discountTotal: 0,
      finalTotalPaid: 1100,
      items: [
        { sourceDescription: "A", quantity: 1, originalGrossUnitCost: 333, originalGrossLineTotal: 333 },
        { sourceDescription: "B", quantity: 1, originalGrossUnitCost: 333, originalGrossLineTotal: 333 },
        { sourceDescription: "C", quantity: 1, originalGrossUnitCost: 334, originalGrossLineTotal: 334 },
      ],
    };
    const result = calculatePurchaseCosts(doc);
    const [a, b, c] = result.items;
    assert.equal(a.allocatedShipping, 33);
    assert.equal(b.allocatedShipping, 33);
    assert.equal(c.allocatedShipping, 34); // largest remainder
  });

  it("handles zero shipping and zero discount", () => {
    const doc = makeDoc({ shippingTotal: 0, discountTotal: 0, finalTotalPaid: 1000 });
    const result = calculatePurchaseCosts(doc);
    const [a, b] = result.items;
    assert.equal(a.allocatedShipping, 0);
    assert.equal(b.allocatedShipping, 0);
    assert.equal(a.allocatedDiscount, 0);
    assert.equal(b.allocatedDiscount, 0);
  });

  it("properly allocates £1 (100 pennies) across 3 equal lines", () => {
    const doc: NormalizedPurchaseDocument = {
      importHash: "hash",
      sourceOrderReference: "ref",
      originalGrossMerchandiseTotal: 300,
      shippingTotal: 100,
      discountTotal: 0,
      finalTotalPaid: 400,
      items: [
        { sourceDescription: "A", quantity: 1, originalGrossUnitCost: 100, originalGrossLineTotal: 100 },
        { sourceDescription: "B", quantity: 1, originalGrossUnitCost: 100, originalGrossLineTotal: 100 },
        { sourceDescription: "C", quantity: 1, originalGrossUnitCost: 100, originalGrossLineTotal: 100 },
      ],
    };
    const result = calculatePurchaseCosts(doc);
    const allocations = result.items.map((i) => i.allocatedShipping);
    assert.deepEqual(allocations, [34, 33, 33]);
  });

  it("finalUnitCost with quantity >1 works correctly", () => {
    const doc: NormalizedPurchaseDocument = {
      importHash: "hash",
      sourceOrderReference: "ref",
      originalGrossMerchandiseTotal: 1000,
      shippingTotal: 0,
      discountTotal: 0,
      finalTotalPaid: 1000,
      items: [
        { sourceDescription: "A", quantity: 3, originalGrossUnitCost: 333, originalGrossLineTotal: 1000 },
      ],
    };
    const result = calculatePurchaseCosts(doc);
    const item = result.items[0];
    assert.equal(item.finalUnitCost, "3.333333");
  });

  it("throws on merchandise total mismatch", () => {
    const doc = makeDoc({ originalGrossMerchandiseTotal: 900 });
    assert.throws(() => calculatePurchaseCosts(doc), MerchandiseTotalMismatchError);
  });

  it("throws when finalTotalPaid does not match reconciliation", () => {
    const doc = makeDoc({ finalTotalPaid: 1200 });
    assert.throws(() => calculatePurchaseCosts(doc), CostReconciliationFailedError);
  });

  it("throws on negative acquisition cost", () => {
    const doc = makeDoc({ shippingTotal: 100, discountTotal: 1200, finalTotalPaid: 0 });
    assert.throws(() => calculatePurchaseCosts(doc), ValidationError);
  });

  it("throws on zero merchandise with shipping", () => {
    const doc: NormalizedPurchaseDocument = {
      importHash: "hash",
      sourceOrderReference: "ref",
      originalGrossMerchandiseTotal: 0,
      shippingTotal: 10,
      discountTotal: 0,
      finalTotalPaid: 10,
      items: [
        { sourceDescription: "A", quantity: 1, originalGrossUnitCost: 0, originalGrossLineTotal: 0 },
      ],
    };
    assert.throws(() => calculatePurchaseCosts(doc), ValidationError);
  });

  it("throws on quantity <= 0", () => {
    const doc1 = makeDoc();
    doc1.items[0].quantity = 0;
    assert.throws(() => calculatePurchaseCosts(doc1), ValidationError);
    const doc2 = makeDoc();
    doc2.items[0].quantity = -1;
    assert.throws(() => calculatePurchaseCosts(doc2), ValidationError);
  });

  it("throws on non‑integer quantity", () => {
    const doc = makeDoc();
    // @ts-ignore intentionally wrong type
    doc.items[0].quantity = 2.5;
    assert.throws(() => calculatePurchaseCosts(doc), ValidationError);
  });

  it("throws on empty items list", () => {
    const doc = makeDoc();
    doc.items = [];
    assert.throws(() => calculatePurchaseCosts(doc), ValidationError);
  });

  it("throws on blank importHash", () => {
    const doc = makeDoc({ importHash: "" });
    assert.throws(() => calculatePurchaseCosts(doc), ValidationError);
  });

  it("throws on blank sourceOrderReference", () => {
    const doc = makeDoc({ sourceOrderReference: "" });
    assert.throws(() => calculatePurchaseCosts(doc), ValidationError);
  });

  it("throws on blank sourceDescription", () => {
    const doc = makeDoc();
    doc.items[0].sourceDescription = "";
    assert.throws(() => calculatePurchaseCosts(doc), ValidationError);
  });

  it("throws on fractional‑penny monetary input", () => {
    const doc = makeDoc();
    // @ts-ignore intentionally fractional
    doc.items[0].originalGrossUnitCost = 5.5;
    assert.throws(() => calculatePurchaseCosts(doc), ValidationError);
  });

  it("throws on unsafe‑integer monetary input", () => {
    const doc = makeDoc();
    // @ts-ignore exceeding safe integer
    doc.items[0].originalGrossUnitCost = 9007199254740993; // MAX_SAFE_INTEGER + 1
    assert.throws(() => calculatePurchaseCosts(doc), ValidationError);
  });

  it("keeps identical products separate", () => {
    const doc: NormalizedPurchaseDocument = {
      importHash: "hash",
      sourceOrderReference: "ref",
      originalGrossMerchandiseTotal: 2000,
      shippingTotal: 200,
      discountTotal: 0,
      finalTotalPaid: 2200,
      items: [
        { sourceDescription: "Same", quantity: 1, originalGrossUnitCost: 1000, originalGrossLineTotal: 1000 },
        { sourceDescription: "Same", quantity: 1, originalGrossUnitCost: 1000, originalGrossLineTotal: 1000 },
      ],
    };
    const result = calculatePurchaseCosts(doc);
    assert.equal(result.items.length, 2);
  });

  it("does not mutate input document", () => {
    const original = makeDoc();
    const copy = JSON.parse(JSON.stringify(original));
    calculatePurchaseCosts(original);
    assert.deepEqual(original, copy);
  });

  // Lightweight proportional tests
  it("proportional shipping only", () => {
    const doc: NormalizedPurchaseDocument = {
      importHash: "hash",
      sourceOrderReference: "ref",
      originalGrossMerchandiseTotal: 1000,
      shippingTotal: 200,
      discountTotal: 0,
      finalTotalPaid: 1200,
      items: [
        { sourceDescription: "A", quantity: 1, originalGrossUnitCost: 500, originalGrossLineTotal: 500 },
        { sourceDescription: "B", quantity: 1, originalGrossUnitCost: 500, originalGrossLineTotal: 500 },
      ],
    };
    const result = calculatePurchaseCosts(doc);
    const [a, b] = result.items;
    assert.equal(a.allocatedShipping, 100);
    assert.equal(b.allocatedShipping, 100);
    assert.equal(a.allocatedDiscount, 0);
    assert.equal(b.allocatedDiscount, 0);
  });

  it("proportional discount only", () => {
    const doc: NormalizedPurchaseDocument = {
      importHash: "hash",
      sourceOrderReference: "ref",
      originalGrossMerchandiseTotal: 1000,
      shippingTotal: 0,
      discountTotal: 200,
      finalTotalPaid: 800,
      items: [
        { sourceDescription: "A", quantity: 1, originalGrossUnitCost: 500, originalGrossLineTotal: 500 },
        { sourceDescription: "B", quantity: 1, originalGrossUnitCost: 500, originalGrossLineTotal: 500 },
      ],
    };
    const result = calculatePurchaseCosts(doc);
    const [a, b] = result.items;
    assert.equal(a.allocatedShipping, 0);
    assert.equal(b.allocatedShipping, 0);
    assert.equal(a.allocatedDiscount, 100);
    assert.equal(b.allocatedDiscount, 100);
  });
});
