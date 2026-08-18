import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { extractPdfText, PdfTextExtractionError } from "../domain/purchases/pdfTextExtractor.js";

// Resolve the fixture path relative to the project root.
const fixturePath = path.resolve(
  process.cwd(),
  "src/__tests__/fixtures/purchases/multiPagePurchaseInvoice.pdf",
);

/** Helper that reads the fixture into a Uint8Array */
function readFixture(): Uint8Array {
  return Uint8Array.from(fs.readFileSync(fixturePath));
}

describe("extractPdfText", () => {
  it("extracts two pages from the real PDF fixture", async () => {
    const pdfBytes = readFixture();
    const result = await extractPdfText(pdfBytes);
    assert.strictEqual(result.pageCount, 2, "pageCount should be 2");
    assert.strictEqual(result.pages.length, 2, "pages array length should be 2");
    assert.deepStrictEqual(
      result.pages.map((p) => p.pageNumber),
      [1, 2],
      "page numbers should be [1, 2]",
    );
    const page1 = result.pages[0].text;
    const page2 = result.pages[1].text;
    assert(page1.includes("Order #"), "Page 1 should contain 'Order #'");
    assert(page1.includes("202-6362918-3056349"), "Page 1 should contain invoice number");
    assert(page1.includes("GB66XG5UVAEUI"), "Page 1 should contain order code");
    assert(page1.includes("B0DWDLM9XS"), "Page 1 should contain purchase code");
    assert(page2.includes("Invoice total"), "Page 2 should contain 'Invoice total'");
    assert(page2.includes("168.10"), "Page 2 should contain total amount");
    assert(page2.includes("Shipping Charges"), "Page 2 should contain shipping charges");
    assert(page2.includes("Promotions"), "Page 2 should contain promotions");
  });

  it("rejects empty input with PdfTextExtractionError", async () => {
    await assert.rejects(
      async () => {
        await extractPdfText(new Uint8Array());
      },
      PdfTextExtractionError,
      "empty input should throw PdfTextExtractionError",
    );
  });

  it("rejects invalid PDF bytes with PdfTextExtractionError", async () => {
    const bogus = Uint8Array.from([0, 1, 2, 3, 4]);
    await assert.rejects(
      async () => {
        await extractPdfText(bogus);
      },
      PdfTextExtractionError,
      "invalid PDF should throw PdfTextExtractionError",
    );
  });
});
