import assert from "node:assert";
import path from "node:path";
import fs from "node:fs";
import { describe, it, beforeEach, afterEach, after } from "node:test";

import { prisma } from "../prisma/runtime.js";
import { importAmazonPurchaseInvoice } from "../domain/purchases/purchaseImportService.js";
import { DuplicateImportError } from "../domain/purchases/purchasePersistence.js";
import { multiPagePurchaseInvoiceFixture } from "./fixtures/purchases/multiPagePurchaseInvoice.fixture.js";

/**
 * Helper that deletes all data associated with a temporary test user.  The
 * cleanup is intentionally scoped to the data created by the test user to
 * avoid accidental data loss.
 */
async function cleanup(userId: number): Promise<void> {
  // 1️⃣  Find all purchase documents for this user
  const purchaseDocs = await prisma.purchaseDocument.findMany({
    where: { importedByUserId: userId },
    select: { id: true, purchaseId: true },
  });
  const docIds = purchaseDocs.map((d) => d.id);
  const purchaseIds = purchaseDocs.map((d) => d.purchaseId);
  // 2️⃣  Delete purchase items
  if (docIds.length) {
    await prisma.purchaseItem.deleteMany({ where: { purchaseDocumentId: { in: docIds } } });
    await prisma.purchaseDocument.deleteMany({ where: { id: { in: docIds } } });
  }
  // 3️⃣  Delete purchases that no longer have associated documents
  if (purchaseIds.length) {
    const remainingDocs = await prisma.purchaseDocument.findMany({
      where: { purchaseId: { in: purchaseIds } },
      select: { purchaseId: true },
    });
    const remainingPurchaseIds = new Set(remainingDocs.map((d) => d.purchaseId));
    const idsToDelete = purchaseIds.filter((id) => !remainingPurchaseIds.has(id));
    if (idsToDelete.length) {
      await prisma.purchase.deleteMany({ where: { id: { in: idsToDelete } } });
    }
  }
  // 4️⃣  Finally delete the user
  await prisma.user.deleteMany({ where: { id: userId } });
}

describe("purchaseImportService", () => {
  let userId: number;
  const fixturePath = path.resolve(
  process.cwd(),
  "src/__tests__/fixtures/purchases/multiPagePurchaseInvoice.pdf",
);

  function readPdfFixture(): Uint8Array {
    return Uint8Array.from(fs.readFileSync(fixturePath));
  }

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        email: `import-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
        passwordHash: "test-password-hash",
      },
    });
    userId = user.id;
  });

  afterEach(async () => {
    if (userId) {
      await cleanup(userId);
    }
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("imports a multi‑page Amazon invoice and persists data", async () => {
    await importAmazonPurchaseInvoice(
      readPdfFixture(),
      multiPagePurchaseInvoiceFixture.importHash,
      userId,
    );

    const purchaseDoc = await prisma.purchaseDocument.findFirst({
      where: { importHash: multiPagePurchaseInvoiceFixture.importHash },
      include: { purchaseItems: { orderBy: { sourceLineNumber: "asc" } }, purchase: true },
    });
    assert(purchaseDoc, "PurchaseDocument not found after import");

    // Basic document fields
    assert.strictEqual(purchaseDoc.sourceInvoiceReference, multiPagePurchaseInvoiceFixture.sourceInvoiceReference);
    assert.strictEqual(purchaseDoc.originalGrossMerchandiseTotal.toFixed(2), "171.09");
    assert.strictEqual(purchaseDoc.shippingTotal.toFixed(2), "0.00");
    assert.strictEqual(purchaseDoc.discountTotal.toFixed(2), "2.99");
    assert.strictEqual(purchaseDoc.finalTotalPaid.toFixed(2), "168.10");
    assert.strictEqual(purchaseDoc.importedByUserId, userId);
    assert.strictEqual(purchaseDoc.partNumber, 1);

    // Items count and content
    assert.strictEqual(purchaseDoc.purchaseItems.length, 5);
    const items = purchaseDoc.purchaseItems;
    // Compare source description and externalProductId for the first item
    assert.strictEqual(items[0].sourceDescription, multiPagePurchaseInvoiceFixture.items[0].sourceDescription);
    assert.strictEqual(items[0].externalProductId, multiPagePurchaseInvoiceFixture.items[0].externalProductId);
    assert.strictEqual(items[0].quantity, 2);
    assert.strictEqual(items[0].originalGrossUnitCost.toFixed(2), "37.04");
    assert.strictEqual(items[0].originalGrossLineTotal.toFixed(2), "74.08");
  });

  it("throws DuplicateImportError when the same hash is used twice", async () => {
    
    await importAmazonPurchaseInvoice(readPdfFixture(), multiPagePurchaseInvoiceFixture.importHash, userId);
    let error: unknown;
    try {
      await importAmazonPurchaseInvoice(readPdfFixture(), multiPagePurchaseInvoiceFixture.importHash, userId);
    } catch (e) {
      error = e;
    }
    assert(error instanceof DuplicateImportError, "Expected DuplicateImportError instance");
  });

  it("rejects invalid PDF and does not create a purchase", async () => {
    const invalidBytes = new Uint8Array();
    let error: unknown;
    try {
      await importAmazonPurchaseInvoice(invalidBytes, "INVALID_HASH", userId);
    } catch (e) {
      error = e;
    }
    assert(error instanceof Error, "Expected an Error instance for invalid PDF");
    const doc = await prisma.purchaseDocument.findFirst({ where: { importedByUserId: userId, importHash: "INVALID_HASH" } });
    assert(!doc, "No PurchaseDocument should be created for invalid PDF");
  });
});
