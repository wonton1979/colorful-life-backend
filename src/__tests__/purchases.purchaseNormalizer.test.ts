import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  normalizePurchaseDocument,
  PurchaseNormalizationError,
} from "../domain/purchases/purchaseNormalizer.js";

import {
  calculatePurchaseCosts,
} from "../domain/purchases/purchaseImport.js";

// -----------------------------------------------------------------------------
// Helper to generate a base source document that can be overridden in tests.
// -----------------------------------------------------------------------------
function makeSrc(overrides = {}) {
  const base = {
    importHash: "hash-1",
    sourceOrderReference: "ORDER-1",
    originalGrossMerchandiseTotal: "100.00",
    shippingTotal: "10.00",
    discountTotal: "5.00",
    finalTotalPaid: "115.00",
    sourceOrderDate: "17 Aug 2026",
    sourceDocumentDate: "17 Aug 2026",
    merchantName: "Merchant Inc.",
    sourceInvoiceReference: "INV-123",
    items: [
      {
        sourceDescription: "Item A",
        quantity: 2,
        originalGrossUnitCost: "30.00",
        originalGrossLineTotal: "60.00",
        sourceLineNumber: 1,
        productListingId: 10,
        externalProductId: "EXT-001",
        sourceSetNumber: "SET-01",
      },
      {
        sourceDescription: "Item B",
        quantity: 1,
        originalGrossUnitCost: "20.00",
        originalGrossLineTotal: "20.00",
        sourceLineNumber: 2,
        productListingId: 20,
        externalProductId: "EXT-002",
        sourceSetNumber: "SET-02",
      },
    ],
  };
  return { ...JSON.parse(JSON.stringify(base)), ...overrides };
}

// -----------------------------------------------------------------------------
// Money parsing tests
// -----------------------------------------------------------------------------
describe("normalizePurchaseDocument – money parsing", () => {
  const validValues = [
    { field: "originalGrossMerchandiseTotal", input: "£37.04", expected: 3704 },
    { field: "originalGrossMerchandiseTotal", input: "37.04", expected: 3704 },
    { field: "originalGrossMerchandiseTotal", input: "37", expected: 3700 },
    { field: "originalGrossMerchandiseTotal", input: 0, expected: 0 },
    { field: "originalGrossMerchandiseTotal", input: 10.5, expected: 1050 },
  ];
  validValues.forEach((v) => {
    it(`should parse ${v.input} for ${v.field}`, () => {
      const src = makeSrc({ [v.field]: v.input });
      const norm = normalizePurchaseDocument(src);
      assert.equal(norm.originalGrossMerchandiseTotal, v.expected);
    });
  });
  const invalidValues = [
    { field: "originalGrossMerchandiseTotal", input: "" },
    { field: "originalGrossMerchandiseTotal", input: "£" },
    { field: "originalGrossMerchandiseTotal", input: "123.456" },
    { field: "originalGrossMerchandiseTotal", input: "$12.34" },
    { field: "originalGrossMerchandiseTotal", input: "12,34" },
    { field: "originalGrossMerchandiseTotal", input: -5 },
    { field: "originalGrossMerchandiseTotal", input: { val: 10 } },
  ];
  invalidValues.forEach((v) => {
    it(`should reject ${JSON.stringify(v.input)} for ${v.field}`, () => {
      const src = makeSrc({ [v.field]: v.input });
      assert.throws(() => normalizePurchaseDocument(src), PurchaseNormalizationError);
    });
  });
});

// -----------------------------------------------------------------------------
// Quantity parsing tests
// -----------------------------------------------------------------------------
describe("normalizePurchaseDocument – quantity parsing", () => {
  const validQty = [1, "1", 10, "10"];
  validQty.forEach((q) => {
    it(`should accept quantity ${JSON.stringify(q)}`, () => {
      const src = makeSrc({
        items: [{
          sourceDescription: "QItem",
          quantity: q,
          originalGrossUnitCost: "10.00",
          originalGrossLineTotal: "10.00",
        }],
      });
      const norm = normalizePurchaseDocument(src);
      assert.equal(norm.items[0].quantity, Number(q));
    });
  });
  const invalidQty = [0, -1, "0", "-5", "3.5", "abc", null, undefined, {}, []];
  invalidQty.forEach((q) => {
    it(`should reject quantity ${JSON.stringify(q)}`, () => {
      const src = makeSrc({
        items: [{
          sourceDescription: "QItem",
          quantity: q,
          originalGrossUnitCost: "10.00",
          originalGrossLineTotal: "10.00",
        }],
      });
      assert.throws(() => normalizePurchaseDocument(src), PurchaseNormalizationError);
    });
  });
});

// -----------------------------------------------------------------------------
// Optional number (shipping/discount) tests
// -----------------------------------------------------------------------------
describe("normalizePurchaseDocument – optional numbers", () => {
  const validNumbers = ["5.00", 5, "0", 0, "10.5", 10.5];
  validNumbers.forEach((v) => {
    it(`should accept shippingTotal as ${JSON.stringify(v)}`, () => {
      const src = makeSrc({ shippingTotal: v });
      const norm = normalizePurchaseDocument(src);
      assert.equal(norm.shippingTotal, parseFloat(v.toString()) * 100);
    });
  });
  const invalidNumbers = ["-5.00", -5, "abc"]; // undefined, null, {} are valid (default to 0)
  invalidNumbers.forEach((v) => {
    it(`should reject shippingTotal ${JSON.stringify(v)}`, () => {
      const src = makeSrc({ shippingTotal: v });
      assert.throws(() => normalizePurchaseDocument(src), PurchaseNormalizationError);
    });
  });
  it("should default missing shippingTotal to 0", () => {
    const src = makeSrc({ shippingTotal: undefined });
    const norm = normalizePurchaseDocument(src);
    assert.equal(norm.shippingTotal, 0);
  });
  it("should default missing discountTotal to 0", () => {
    const src = makeSrc({ discountTotal: undefined });
    const norm = normalizePurchaseDocument(src);
    assert.equal(norm.discountTotal, 0);
  });
});

// -----------------------------------------------------------------------------
// Optional date tests
// -----------------------------------------------------------------------------
describe("normalizePurchaseDocument – optional dates", () => {
  const validDates = [
    "2026-08-17",
    "17 Aug 2026",
  ];
  validDates.forEach((v) => {
    it(`should accept sourceOrderDate ${JSON.stringify(v)}`, () => {
      const src = makeSrc({ sourceOrderDate: v });
      const norm = normalizePurchaseDocument(src);
      assert.equal(norm.sourceOrderDate, "2026-08-17");
    });
  });
  const invalidDates = ["", "2026-13-01", "2026/08/17", {}];
  invalidDates.forEach((v) => {
    it(`should reject sourceOrderDate ${JSON.stringify(v)}`, () => {
      const src = makeSrc({ sourceOrderDate: v });
      assert.throws(() => normalizePurchaseDocument(src), PurchaseNormalizationError);
    });
  });
  it("should leave sourceDocumentDate undefined when omitted", () => {
    const src = makeSrc({ sourceDocumentDate: undefined });
    const norm = normalizePurchaseDocument(src);
    assert.equal(norm.sourceDocumentDate, undefined);
  });
  it("should leave sourceOrderDate undefined when omitted", () => {
    const src = makeSrc({ sourceOrderDate: undefined });
    const norm = normalizePurchaseDocument(src);
    assert.equal(norm.sourceOrderDate, undefined);
  });
});

// -----------------------------------------------------------------------------
// Optional string tests
// -----------------------------------------------------------------------------
describe("normalizePurchaseDocument – optional strings", () => {
  const values = ["  merchant  ", "merchant", "  ", "" ];
  values.forEach((v) => {
    it(`merchantName with value ${JSON.stringify(v)}`, () => {
      const src = makeSrc({ merchantName: v });
      const norm = normalizePurchaseDocument(src);
      if (v.trim() === "") {
        assert.equal(norm.merchantName, undefined);
      } else {
        assert.equal(norm.merchantName, v.trim());
      }
    });
  });
});

// -----------------------------------------------------------------------------
// Items array validation
// -----------------------------------------------------------------------------
describe("normalizePurchaseDocument – items array validation", () => {
  it("should reject empty items array", () => {
    const src = makeSrc({ items: [] });
    assert.throws(() => normalizePurchaseDocument(src), PurchaseNormalizationError);
  });
  it("should reject missing items array", () => {
    const src = makeSrc();
    delete src.items;
    assert.throws(() => normalizePurchaseDocument(src), PurchaseNormalizationError);
  });
});

// -----------------------------------------------------------------------------
// Item field validation
// -----------------------------------------------------------------------------
describe("normalizePurchaseDocument – item field validation", () => {
  const baseItem = {
    sourceDescription: "Desc",
    quantity: 1,
    originalGrossUnitCost: "10.00",
    originalGrossLineTotal: "10.00",
  };
  it("should reject blank sourceDescription", () => {
    const src = makeSrc({ items: [{ ...baseItem, sourceDescription: "" }] });
    assert.throws(() => normalizePurchaseDocument(src), PurchaseNormalizationError);
  });
  it("should reject negative originalGrossUnitCost", () => {
    const src = makeSrc({ items: [{ ...baseItem, originalGrossUnitCost: "-5.00" }] });
    assert.throws(() => normalizePurchaseDocument(src), PurchaseNormalizationError);
  });
  it("should reject non‑numeric originalGrossLineTotal", () => {
    const src = makeSrc({ items: [{ ...baseItem, originalGrossLineTotal: "abc" }] });
    assert.throws(() => normalizePurchaseDocument(src), PurchaseNormalizationError);
  });
  it("should reject zero sourceLineNumber", () => {
    const src = makeSrc({ items: [{ ...baseItem, sourceLineNumber: 0 }] });
    assert.throws(() => normalizePurchaseDocument(src), PurchaseNormalizationError);
  });
  it("should reject negative productListingId", () => {
    const src = makeSrc({ items: [{ ...baseItem, productListingId: -1 }] });
    assert.throws(() => normalizePurchaseDocument(src), PurchaseNormalizationError);
  });
});

// -----------------------------------------------------------------------------
// Immutability test
// -----------------------------------------------------------------------------
describe("normalizePurchaseDocument – immutability", () => {
  it("should not mutate the original source object", () => {
    const src = makeSrc();
    const copy = JSON.parse(JSON.stringify(src));
    normalizePurchaseDocument(src);
    assert.deepEqual(src, copy);
  });
});

it("integration: normalize -> calculatePurchaseCosts", () => {
  const src = {
    importHash: "hash-2",
    sourceOrderReference: "ORDER-2",
    originalGrossMerchandiseTotal: "50.00",
    shippingTotal: "5.00",
    discountTotal: "2.00",
    finalTotalPaid: "53.00",
    items: [
      {
        sourceDescription: "X",
        quantity: 1,
        originalGrossUnitCost: "30.00",
        originalGrossLineTotal: "30.00",
      },
      {
        sourceDescription: "Y",
        quantity: 1,
        originalGrossUnitCost: "20.00",
        originalGrossLineTotal: "20.00",
      },
    ],
  };

  const normalized = normalizePurchaseDocument(src);
  const calculated = calculatePurchaseCosts(normalized);

  assert.equal(calculated.items.length, 2);

  const [x, y] = calculated.items;

  assert.equal(x.allocatedShipping, 300);
  assert.equal(y.allocatedShipping, 200);

  assert.equal(x.allocatedDiscount, 120);
  assert.equal(y.allocatedDiscount, 80);

  assert.equal(x.finalLineCost, 3180);
  assert.equal(y.finalLineCost, 2120);
});