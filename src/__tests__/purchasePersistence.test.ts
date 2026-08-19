import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach, after } from "node:test";

import { prisma } from "../prisma/runtime.js";

import {
  persistCalculatedPurchaseDocument,
  DuplicateImportError,
} from "../domain/purchases/purchasePersistence.js";
import { calculatePurchaseCosts } from "../domain/purchases/purchaseImport.js";
import type { NormalizedPurchaseDocument } from "../domain/purchases/purchaseImport.js";

function makeBaseDoc(
  overrides: Partial<NormalizedPurchaseDocument> = {},
): NormalizedPurchaseDocument {
  const base: NormalizedPurchaseDocument = {
    importHash: `hash-${Math.random().toString(36).substring(2, 10)}`,
    sourceOrderReference: `SO-${Math.random().toString(36).substring(2, 10)}`,
    originalGrossMerchandiseTotal: 1000,
    shippingTotal: 200,
    discountTotal: 50,
    finalTotalPaid: 1150,
    items: [
      {
        sourceDescription: "Item A",
        quantity: 1,
        originalGrossUnitCost: 1000,
        originalGrossLineTotal: 1000,
      },
    ],
  };

  return { ...base, ...overrides } as NormalizedPurchaseDocument;
}

async function persistDoc(
  doc: NormalizedPurchaseDocument,
  userId: number,
): Promise<void> {
  const calculated = calculatePurchaseCosts(doc);
  await persistCalculatedPurchaseDocument(calculated, userId);
}

async function cleanup(
  ref: string,
  importHashes: string[],
): Promise<void> {
  const docRows = await prisma.purchaseDocument.findMany({
    where: { importHash: { in: importHashes } },
    select: { id: true },
  });

  const docIds = docRows.map((d) => d.id);

  if (docIds.length) {
    await prisma.purchaseItem.deleteMany({
      where: { purchaseDocumentId: { in: docIds } },
    });

    await prisma.purchaseDocument.deleteMany({
      where: { importHash: { in: importHashes } },
    });
  }

  await prisma.purchase.deleteMany({
    where: { sourceOrderReference: ref },
  });
}

describe("Purchase persistence layer", () => {
  let userId: number;
  let testUserEmail: string;

  beforeEach(async () => {
    testUserEmail =
      `purchase-test-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}@example.com`;

    const user = await prisma.user.create({
      data: {
        email: testUserEmail,
        passwordHash: "test-password-hash",
      },
    });

    userId = user.id;
  });

  afterEach(async () => {
    await prisma.user.deleteMany({
      where: { email: testUserEmail },
    });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("persists a calculated purchase document successfully", async () => {
    const doc = makeBaseDoc();
    await persistDoc(doc, userId);

    const purchase = await prisma.purchase.findUnique({
      where: { sourceOrderReference: doc.sourceOrderReference },
      include: {
        purchaseDocuments: {
          include: { purchaseItems: true },
        },
      },
    });

    assert(purchase, "Purchase not found after persistence");
    assert.strictEqual(
      purchase.sourceOrderReference,
      doc.sourceOrderReference,
    );
    assert.strictEqual(purchase.sourceOrderDate, null);
    assert.strictEqual(purchase.merchantName, null);

    const purchaseDoc = purchase.purchaseDocuments[0];
    assert(purchaseDoc, "PurchaseDocument not found");

    assert.strictEqual(purchaseDoc.importHash, doc.importHash);
    assert.strictEqual(purchaseDoc.partNumber, 1);
    assert.strictEqual(purchaseDoc.sourceInvoiceReference, null);
    assert.strictEqual(purchaseDoc.sourceDocumentDate, null);
    assert.strictEqual(purchaseDoc.importedByUserId, userId);
    assert.strictEqual(
      purchaseDoc.originalGrossMerchandiseTotal.toFixed(2),
      "10.00",
    );
    assert.strictEqual(purchaseDoc.shippingTotal.toFixed(2), "2.00");
    assert.strictEqual(purchaseDoc.discountTotal.toFixed(2), "0.50");
    assert.strictEqual(purchaseDoc.finalTotalPaid.toFixed(2), "11.50");

    const item = purchaseDoc.purchaseItems[0];
    assert(item, "PurchaseItem not found");

    assert.strictEqual(item.sourceDescription, "Item A");
    assert.strictEqual(item.sourceLineNumber, null);
    assert.strictEqual(item.externalProductId, null);
    assert.strictEqual(item.sourceSetNumber, null);
    assert.strictEqual(item.quantity, 1);
    assert.strictEqual(item.originalGrossUnitCost.toFixed(2), "10.00");
    assert.strictEqual(item.originalGrossLineTotal.toFixed(2), "10.00");
    assert.strictEqual(item.allocatedShipping.toFixed(2), "2.00");
    assert.strictEqual(item.allocatedDiscount.toFixed(2), "0.50");
    assert.strictEqual(item.finalLineCost.toFixed(2), "11.50");
    assert.strictEqual(item.finalUnitCost.toFixed(6), "11.500000");

    await cleanup(doc.sourceOrderReference, [doc.importHash]);
  });

  it(
    "creates a single purchase for the same sourceOrderReference across multiple documents",
    async () => {
      const base = makeBaseDoc();

      const doc1 = {
        ...base,
        importHash: `hash-${Math.random().toString(36).substring(2, 10)}`,
      };

      const doc2 = {
        ...base,
        importHash: `hash-${Math.random().toString(36).substring(2, 10)}`,
        sourceOrderReference: base.sourceOrderReference,
      };

      await persistDoc(doc1, userId);
      await persistDoc(doc2, userId);

      const purchase = await prisma.purchase.findUnique({
        where: { sourceOrderReference: base.sourceOrderReference },
        include: { purchaseDocuments: true },
      });

      assert(purchase, "Purchase not found after two imports");
      assert.strictEqual(
        purchase.purchaseDocuments.length,
        2,
        "Expected two purchase documents",
      );

      const sorted = purchase.purchaseDocuments.sort(
        (a, b) => a.partNumber - b.partNumber,
      );

      assert.strictEqual(sorted[0].partNumber, 1);
      assert.strictEqual(sorted[1].partNumber, 2);

      await cleanup(
        base.sourceOrderReference,
        [doc1.importHash, doc2.importHash],
      );
    },
  );

  it(
    "throws DuplicateImportError on duplicate importHash and does not create duplicates",
    async () => {
      const doc = makeBaseDoc();
      await persistDoc(doc, userId);

      let error: unknown;

      try {
        await persistDoc(doc, userId);
      } catch (e) {
        error = e;
      }

      assert(
        error instanceof DuplicateImportError,
        "Expected DuplicateImportError",
      );

      const purchaseDocs = await prisma.purchaseDocument.findMany({
        where: { importHash: doc.importHash },
      });

      assert.strictEqual(
        purchaseDocs.length,
        1,
        "Duplicate document should not exist",
      );

      const purchase = await prisma.purchase.findUnique({
        where: { sourceOrderReference: doc.sourceOrderReference },
      });

      assert(purchase, "Purchase missing after duplicate attempt");

      const items = await prisma.purchaseItem.findMany({
        where: { purchaseDocumentId: purchaseDocs[0].id },
      });

      assert.strictEqual(
        items.length,
        1,
        "No extra items should be created on duplicate import",
      );

      await cleanup(doc.sourceOrderReference, [doc.importHash]);
    },
  );

  it(
    "rolls back transaction when foreign-key constraint fails",
    async () => {
      const doc = makeBaseDoc({
        originalGrossMerchandiseTotal: 100,
        shippingTotal: 0,
        discountTotal: 0,
        finalTotalPaid: 100,
        items: [
          {
            sourceDescription: "Invalid",
            quantity: 1,
            originalGrossUnitCost: 100,
            originalGrossLineTotal: 100,
            productListingId: 9999999999,
          },
        ],
      });

      let error: unknown;

      try {
        await persistDoc(doc, userId);
      } catch (e) {
        error = e;
      }

      assert(error, "Expected an error from persistence");

      const purchase = await prisma.purchase.findUnique({
        where: { sourceOrderReference: doc.sourceOrderReference },
      });

      assert(
        !purchase,
        "Purchase should not exist after failed import",
      );

      const purchaseDoc = await prisma.purchaseDocument.findUnique({
        where: { importHash: doc.importHash },
      });

      assert(
        !purchaseDoc,
        "PurchaseDocument should not exist after failed import",
      );
    },
  );

  it("handles missing optional fields correctly", async () => {
    const doc = makeBaseDoc({
      sourceOrderDate: undefined,
      merchantName: undefined,
      sourceInvoiceReference: undefined,
      sourceDocumentDate: undefined,
    });

    await persistDoc(doc, userId);

    const purchase = await prisma.purchase.findUnique({
      where: { sourceOrderReference: doc.sourceOrderReference },
      include: {
        purchaseDocuments: {
          include: { purchaseItems: true },
        },
      },
    });

    assert(purchase, "Purchase not found");
    assert.strictEqual(purchase.sourceOrderDate, null);
    assert.strictEqual(purchase.merchantName, null);

    const purchaseDoc = purchase.purchaseDocuments[0];
    assert(purchaseDoc, "PurchaseDocument not found");

    assert.strictEqual(purchaseDoc.sourceInvoiceReference, null);
    assert.strictEqual(purchaseDoc.sourceDocumentDate, null);

    const item = purchaseDoc.purchaseItems[0];
    assert(item, "PurchaseItem not found");

    assert.strictEqual(item.externalProductId, null);
    assert.strictEqual(item.sourceSetNumber, null);
    assert.strictEqual(item.sourceLineNumber, null);
    assert.strictEqual(item.productListingId, null);

    await cleanup(doc.sourceOrderReference, [doc.importHash]);
  });

  it("persists monetary values exactly to pennies", async () => {
    const doc = makeBaseDoc({
      originalGrossMerchandiseTotal: 17409,
      shippingTotal: 0,
      discountTotal: 0,
      finalTotalPaid: 17409,
      items: [
        {
          sourceDescription: "Penny",
          quantity: 1,
          originalGrossUnitCost: 1,
          originalGrossLineTotal: 1,
        },
        {
          sourceDescription: "ThreeCents",
          quantity: 1,
          originalGrossUnitCost: 299,
          originalGrossLineTotal: 299,
        },
        {
          sourceDescription: "SeventeenHundredOneNinth",
          quantity: 1,
          originalGrossUnitCost: 17109,
          originalGrossLineTotal: 17109,
        },
      ],
    });

    await persistDoc(doc, userId);

    const purchaseDoc = await prisma.purchaseDocument.findUnique({
      where: { importHash: doc.importHash },
    });

    assert(purchaseDoc, "PurchaseDocument missing");

    assert.strictEqual(
      purchaseDoc.originalGrossMerchandiseTotal.toFixed(2),
      "174.09",
    );
    assert.strictEqual(purchaseDoc.shippingTotal.toFixed(2), "0.00");
    assert.strictEqual(purchaseDoc.discountTotal.toFixed(2), "0.00");
    assert.strictEqual(purchaseDoc.finalTotalPaid.toFixed(2), "174.09");

    const items = await prisma.purchaseItem.findMany({
      where: { purchaseDocumentId: purchaseDoc.id },
    });

    const byDesc = items.reduce<
      Record<string, (typeof items)[number]>
    >((acc, item) => {
      acc[item.sourceDescription] = item;
      return acc;
    }, {});

    assert.strictEqual(
      byDesc.Penny.originalGrossUnitCost.toFixed(2),
      "0.01",
    );
    assert.strictEqual(
      byDesc.Penny.originalGrossLineTotal.toFixed(2),
      "0.01",
    );
    assert.strictEqual(
      byDesc.Penny.finalLineCost.toFixed(2),
      "0.01",
    );
    assert.strictEqual(
      byDesc.Penny.finalUnitCost.toFixed(6),
      "0.010000",
    );

    assert.strictEqual(
      byDesc.ThreeCents.originalGrossUnitCost.toFixed(2),
      "2.99",
    );
    assert.strictEqual(
      byDesc.ThreeCents.originalGrossLineTotal.toFixed(2),
      "2.99",
    );
    assert.strictEqual(
      byDesc.ThreeCents.finalLineCost.toFixed(2),
      "2.99",
    );
    assert.strictEqual(
      byDesc.ThreeCents.finalUnitCost.toFixed(6),
      "2.990000",
    );

    assert.strictEqual(
      byDesc.SeventeenHundredOneNinth.originalGrossUnitCost.toFixed(2),
      "171.09",
    );
    assert.strictEqual(
      byDesc.SeventeenHundredOneNinth.originalGrossLineTotal.toFixed(2),
      "171.09",
    );
    assert.strictEqual(
      byDesc.SeventeenHundredOneNinth.finalLineCost.toFixed(2),
      "171.09",
    );
    assert.strictEqual(
      byDesc.SeventeenHundredOneNinth.finalUnitCost.toFixed(6),
      "171.090000",
    );

    await cleanup(doc.sourceOrderReference, [doc.importHash]);
  });
});
