import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach, after } from "node:test";

import { prisma } from "../prisma/runtime.js";
import { persistCalculatedPurchaseDocument } from "../domain/purchases/purchasePersistence.js";
import { calculatePurchaseCosts } from "../domain/purchases/purchaseImport.js";
import type { NormalizedPurchaseDocument } from "../domain/purchases/purchaseImport.js";
import { randomUUID } from "node:crypto";

/**
 * Helper to create a minimal NormalizedPurchaseDocument.
 */
function makeBaseDoc(overrides: Partial<NormalizedPurchaseDocument> = {}): NormalizedPurchaseDocument {
  const base: NormalizedPurchaseDocument = {
    importHash: `hash-${randomUUID()}`,
    sourceOrderReference: `SO-${randomUUID()}`,
    originalGrossMerchandiseTotal: 1000,
    shippingTotal: 200,
    discountTotal: 50,
    finalTotalPaid: 1150,
    items: [],
  };
  return { ...base, ...overrides } as NormalizedPurchaseDocument;
}

// Track created entity IDs for cleanup.
let userId: number;
let testUserEmail: string;
const productIds: number[] = [];
const listingIds: number[] = [];
const inventoryMovementIds: number[] = [];
const trackedOrderReferences: string[] = [];

async function cleanup(): Promise<void> {
  // Delete inventory movements
  if (inventoryMovementIds.length) {
    await prisma.inventoryMovement.deleteMany({ where: { id: { in: inventoryMovementIds } } });
  }
  // Find purchases by tracked references
  const purchases = await prisma.purchase.findMany({ where: { sourceOrderReference: { in: trackedOrderReferences } } });
  const purchaseIds = purchases.map((p) => p.id);
  // Get documents belonging to those purchases
  const docs = await prisma.purchaseDocument.findMany({ where: { purchaseId: { in: purchaseIds } } });
  const docIds = docs.map((d) => d.id);
  // Delete purchase items
  if (docIds.length) {
    await prisma.purchaseItem.deleteMany({ where: { purchaseDocumentId: { in: docIds } } });
  }
  // Delete purchase documents
  if (docIds.length) {
    await prisma.purchaseDocument.deleteMany({ where: { id: { in: docIds } } });
  }
  // Delete purchases
  if (purchaseIds.length) {
    await prisma.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
  }
  // Delete product listings
  if (listingIds.length) {
    await prisma.productListing.deleteMany({ where: { id: { in: listingIds } } });
  }
  // Delete Lego products
  if (productIds.length) {
    await prisma.legoProduct.deleteMany({ where: { id: { in: productIds } } });
  }
  // Delete user
  if (testUserEmail) {
    await prisma.user.deleteMany({ where: { email: testUserEmail } });
  }
  // Reset arrays
  productIds.length = 0;
  listingIds.length = 0;
  inventoryMovementIds.length = 0;
  trackedOrderReferences.length = 0;
}

describe("purchaseItemMatcher persistence integration", () => {
  beforeEach(async () => {
    testUserEmail = `user-${randomUUID()}@example.com`;
    const user = await prisma.user.create({ data: { email: testUserEmail, passwordHash: "test" } });
    userId = user.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("matches a unique sourceSetNumber and persists correct productListingId", async () => {
    const product = await prisma.legoProduct.create({
      data: { setNumber: randomUUID(), title: "Test Prod", theme: "Test", ageRecommendation: "8+", pieceCount: 100 },
    });
    productIds.push(product.id);

    const listing = await prisma.productListing.create({
      data: { legoProductId: product.id, condition: "NEW", originalPrice: 10.0, currentStock: 5 },
    });
    listingIds.push(listing.id);

    const doc = makeBaseDoc({
      items: [
        {
          sourceDescription: "Item A",
          quantity: 1,
          originalGrossUnitCost: 1000,
          originalGrossLineTotal: 1000,
          sourceSetNumber: product.setNumber,
        },
      ],
    });
    // Track reference before persistence
    trackedOrderReferences.push(doc.sourceOrderReference);
    const calculated = calculatePurchaseCosts(doc);
    await persistCalculatedPurchaseDocument(calculated, userId);

    const purchase = await prisma.purchase.findUnique({
      where: { sourceOrderReference: doc.sourceOrderReference },
      include: { purchaseDocuments: { include: { purchaseItems: true } } },
    });
    assert(purchase, "Purchase not found");
    const purchaseDoc = purchase.purchaseDocuments[0];
    assert(purchaseDoc, "PurchaseDocument not found");
    const item = purchaseDoc.purchaseItems[0];
    assert(item, "PurchaseItem not found");
    assert.strictEqual(item.productListingId, listing.id);
  });

  it("allows import when sourceSetNumber is unknown, productListingId is null", async () => {
    const unknownSet = randomUUID();
    const doc = makeBaseDoc({
      items: [
        {
          sourceDescription: "Item B",
          quantity: 1,
          originalGrossUnitCost: 1000,
          originalGrossLineTotal: 1000,
          sourceSetNumber: unknownSet,
        },
      ],
    });
    trackedOrderReferences.push(doc.sourceOrderReference);
    const calculated = calculatePurchaseCosts(doc);
    await persistCalculatedPurchaseDocument(calculated, userId);
    const purchase = await prisma.purchase.findUnique({
      where: { sourceOrderReference: doc.sourceOrderReference },
      include: { purchaseDocuments: { include: { purchaseItems: true } } },
    });
    assert(purchase, "Purchase not found");
    const purchaseDoc = purchase.purchaseDocuments[0];
    assert(purchaseDoc, "PurchaseDocument not found");
    const item = purchaseDoc.purchaseItems[0];
    assert(item, "PurchaseItem not found");
    assert.strictEqual(item.productListingId, null);
  });

  it("preserves explicitly supplied productListingId over a different valid automatic match", async () => {
    const productA = await prisma.legoProduct.create({
      data: { setNumber: randomUUID(), title: "Prod A", theme: "Test", ageRecommendation: "8+", pieceCount: 100 },
    });
    const productB = await prisma.legoProduct.create({
      data: { setNumber: randomUUID(), title: "Prod B", theme: "Test", ageRecommendation: "8+", pieceCount: 100 },
    });
    productIds.push(productA.id, productB.id);

    const listingA = await prisma.productListing.create({
      data: { legoProductId: productA.id, condition: "NEW", originalPrice: 10.0, currentStock: 5 },
    });
    const listingB = await prisma.productListing.create({
      data: { legoProductId: productB.id, condition: "USED_LIKE_NEW", originalPrice: 8.0, currentStock: 3 },
    });
    listingIds.push(listingA.id, listingB.id);

    const doc = makeBaseDoc({
      items: [
        {
          sourceDescription: "Item C",
          quantity: 1,
          originalGrossUnitCost: 1000,
          originalGrossLineTotal: 1000,
          sourceSetNumber: productB.setNumber,
          productListingId: listingA.id,
        },
      ],
    });
    trackedOrderReferences.push(doc.sourceOrderReference);
    const calculated = calculatePurchaseCosts(doc);
    await persistCalculatedPurchaseDocument(calculated, userId);

    const purchase = await prisma.purchase.findUnique({
      where: { sourceOrderReference: doc.sourceOrderReference },
      include: { purchaseDocuments: { include: { purchaseItems: true } } },
    });
    assert(purchase, "Purchase not found");
    const purchaseDoc = purchase.purchaseDocuments[0];
    assert(purchaseDoc, "PurchaseDocument not found");
    const item = purchaseDoc.purchaseItems[0];
    assert(item, "PurchaseItem not found");
    assert.strictEqual(item.productListingId, listingA.id);
  });

  it("does not alter matched ProductListing's currentStock", async () => {
    const product = await prisma.legoProduct.create({
      data: { setNumber: randomUUID(), title: "Prod D", theme: "Test", ageRecommendation: "8+", pieceCount: 100 },
    });
    productIds.push(product.id);
    const listing = await prisma.productListing.create({
      data: { legoProductId: product.id, condition: "NEW", originalPrice: 10.0, currentStock: 5 },
    });
    listingIds.push(listing.id);
    const beforeStock = listing.currentStock;
    const doc = makeBaseDoc({
      items: [
        {
          sourceDescription: "Item D",
          quantity: 1,
          originalGrossUnitCost: 1000,
          originalGrossLineTotal: 1000,
          sourceSetNumber: product.setNumber,
        },
      ],
    });
    trackedOrderReferences.push(doc.sourceOrderReference);
    const calculated = calculatePurchaseCosts(doc);
    await persistCalculatedPurchaseDocument(calculated, userId);
    const updatedListing = await prisma.productListing.findUnique({ where: { id: listing.id } });
    assert(updatedListing, "Listing not found after import");
    assert.strictEqual(updatedListing.currentStock, beforeStock);
  });

  it("does not create InventoryMovement for automatic product matching", async () => {
    const product = await prisma.legoProduct.create({
      data: { setNumber: randomUUID(), title: "Prod E", theme: "Test", ageRecommendation: "8+", pieceCount: 100 },
    });
    productIds.push(product.id);
    const listing = await prisma.productListing.create({
      data: { legoProductId: product.id, condition: "NEW", originalPrice: 10.0, currentStock: 5 },
    });
    listingIds.push(listing.id);
    const initialCount = await prisma.inventoryMovement.count({ where: { listingId: listing.id } });
    const doc = makeBaseDoc({
      items: [
        {
          sourceDescription: "Item E",
          quantity: 1,
          originalGrossUnitCost: 1000,
          originalGrossLineTotal: 1000,
          sourceSetNumber: product.setNumber,
        },
      ],
    });
    trackedOrderReferences.push(doc.sourceOrderReference);
    const calculated = calculatePurchaseCosts(doc);
    await persistCalculatedPurchaseDocument(calculated, userId);
    const finalCount = await prisma.inventoryMovement.count({ where: { listingId: listing.id } });
    assert.strictEqual(finalCount, initialCount);
  });
});
