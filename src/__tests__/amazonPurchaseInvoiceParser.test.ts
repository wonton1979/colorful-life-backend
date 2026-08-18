import assert from "node:assert";
import path from "node:path";
import fs from "node:fs";
import { describe, it } from "node:test";

import { extractPdfText } from "../domain/purchases/pdfTextExtractor.js";
import {
  parseAmazonPurchaseInvoice,
  AmazonPurchaseInvoiceParseError,
} from "../domain/purchases/parsers/amazonPurchaseInvoiceParser.js";
import { multiPagePurchaseInvoiceFixture } from "./fixtures/purchases/multiPagePurchaseInvoice.fixture.js";

/**
 * Helper to create a synthetic ExtractedPdfText from an array of lines.
 */
function buildSyntheticPdfText(lines: string[]): {
  pageCount: number;
  pages: { pageNumber: number; text: string }[];
  fullText?: string;
} {
  const text = lines.join("\n");

  return {
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        text,
      },
    ],
    fullText: text,
  };
}

describe("Amazon UK purchase invoice parser", () => {
  it("parses the real PDF fixture to match the golden fixture", async () => {
    const fixturePath = path.resolve(
      process.cwd(),
      "src/__tests__/fixtures/purchases/multiPagePurchaseInvoice.pdf",
    );

    const pdfBytes = Uint8Array.from(fs.readFileSync(fixturePath));
    const extractedPdf = await extractPdfText(pdfBytes);

    const parsed = parseAmazonPurchaseInvoice(
      extractedPdf,
      multiPagePurchaseInvoiceFixture.importHash,
    );

    assert.deepStrictEqual(parsed, multiPagePurchaseInvoiceFixture);
  });

  it("captures the cross-page item correctly", async () => {
    const fixturePath = path.resolve(
      process.cwd(),
      "src/__tests__/fixtures/purchases/multiPagePurchaseInvoice.pdf",
    );

    const pdfBytes = Uint8Array.from(fs.readFileSync(fixturePath));
    const extractedPdf = await extractPdfText(pdfBytes);

    const parsed = parseAmazonPurchaseInvoice(
      extractedPdf,
      multiPagePurchaseInvoiceFixture.importHash,
    );

    assert.strictEqual(parsed.items.length, 5);

    const item5 = parsed.items[4];

    assert.strictEqual(item5.sourceLineNumber, 5);
    assert.strictEqual(item5.externalProductId, "B0DNZS14DR");
    assert.strictEqual(item5.sourceSetNumber, "76972");
    assert.strictEqual(item5.quantity, 1);
    assert.strictEqual(item5.originalGrossUnitCost, "19.99");
    assert.strictEqual(item5.originalGrossLineTotal, "19.99");

    assert.strictEqual(
      item5.sourceDescription,
      "LEGO Jurassic World Raptor Off-Road Escape Dinosaur Toy - incl. 2 Dino Figures, Off-Road Car Toy & 2 Minifigures - Gift for 6+ Year Old Boys, Girls & Rebirth Movie Fans - 76972",
    );
  });

  it("parses a minimal invoice without promotions", () => {
    const lines = [
      "Order # TESTORDER",
      "Order date 01 Aug 2026",
      "Sold by Amazon EU S.à r.l., UK Branch",
      "Invoice # INV123",
      "Invoice date / Delivery date 02 Aug 2026",
      "Description Qty Unit price",
      "(excl. VAT)",
      "VAT rate Unit price",
      "(incl. VAT)",
      "Item subtotal",
      "(incl. VAT)",
      "Test Item",
      "ASIN: B0ABC12345",
      "1 £10.00 0% £10.00 £10.00",
      "Invoice total £10.00",
    ];

    const extractedPdf = buildSyntheticPdfText(lines);

    const parsed = parseAmazonPurchaseInvoice(
      extractedPdf,
      "TEST_HASH",
    );

    assert.strictEqual(parsed.discountTotal, undefined);
    assert.strictEqual(parsed.finalTotalPaid, "10.00");
    assert.strictEqual(parsed.items.length, 1);
  });

  it("parses a minimal invoice without shipping charges", () => {
    const lines = [
      "Order # TESTORDER",
      "Order date 01 Aug 2026",
      "Sold by Amazon EU S.à r.l., UK Branch",
      "Invoice # INV123",
      "Invoice date / Delivery date 02 Aug 2026",
      "Description Qty Unit price",
      "(excl. VAT)",
      "VAT rate Unit price",
      "(incl. VAT)",
      "Item subtotal",
      "(incl. VAT)",
      "Test Item",
      "ASIN: B0ABC12345",
      "1 £10.00 0% £10.00 £10.00",
      "Invoice total £10.00",
    ];

    const extractedPdf = buildSyntheticPdfText(lines);

    const parsed = parseAmazonPurchaseInvoice(
      extractedPdf,
      "TEST_HASH",
    );

    assert.strictEqual(parsed.shippingTotal, undefined);
    assert.strictEqual(parsed.finalTotalPaid, "10.00");
    assert.strictEqual(parsed.items.length, 1);
  });

  it("throws AmazonPurchaseInvoiceParseError when order reference is missing", () => {
    const lines = [
      "Order date 01 Aug 2026",
      "Sold by Amazon EU S.à r.l., UK Branch",
      "Invoice # INV123",
      "Invoice date / Delivery date 02 Aug 2026",
      "Description Qty Unit price",
      "(excl. VAT)",
      "VAT rate Unit price",
      "(incl. VAT)",
      "Item subtotal",
      "(incl. VAT)",
      "Test Item",
      "ASIN: B0ABC12345",
      "1 £10.00 0% £10.00 £10.00",
      "Invoice total £10.00",
    ];

    const extractedPdf = buildSyntheticPdfText(lines);

    assert.throws(
      () => parseAmazonPurchaseInvoice(extractedPdf, "TEST_HASH"),
      AmazonPurchaseInvoiceParseError,
    );
  });

  it("throws AmazonPurchaseInvoiceParseError when an item is incomplete", () => {
    const lines = [
      "Order # TESTORDER",
      "Order date 01 Aug 2026",
      "Sold by Amazon EU S.à r.l., UK Branch",
      "Invoice # INV123",
      "Invoice date / Delivery date 02 Aug 2026",
      "Description Qty Unit price",
      "(excl. VAT)",
      "VAT rate Unit price",
      "(incl. VAT)",
      "Item subtotal",
      "(incl. VAT)",
      "Test Item",
      "ASIN: B0ABC12345",
      // Price row intentionally omitted.
    ];

    const extractedPdf = buildSyntheticPdfText(lines);

    assert.throws(
      () => parseAmazonPurchaseInvoice(extractedPdf, "TEST_HASH"),
      AmazonPurchaseInvoiceParseError,
    );
  });
});