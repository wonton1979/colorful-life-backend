import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { prisma } from "../prisma/runtime.js";
import { config } from "../config/index.js";
import { ListingCondition, InventoryMovementType } from "../generated/prisma-client/enums.js";

// Tracking arrays for cleanup
const userIds: number[] = [];
const legoProductIds: number[] = [];
const listingIds: number[] = [];
const purchaseIds: number[] = [];
const purchaseDocIds: number[] = [];
const purchaseItemIds: number[] = [];
const inventoryMovementIds: number[] = [];

// Helper to track persisted records for cleanup
function trackPurchaseDocument(doc: any): void {
  purchaseDocIds.push(doc.id);
  purchaseIds.push(doc.purchase.id);
  for (const item of doc.purchaseItems ?? []) {
    purchaseItemIds.push(item.id);
  }
}

let server: any;
let baseUrl: string;
let userToken: string;
let userId: number;

before(() => {
  server = app.listen(0);
  const address = server.address() as any;
  baseUrl = `http://localhost:${address.port}`;
});

after(async () => {
  await prisma.$disconnect();
  server.close();
});

async function cleanup(): Promise<void> {
  if (inventoryMovementIds.length) {
    await prisma.inventoryMovement.deleteMany({ where: { id: { in: inventoryMovementIds } } });
  }
  if (purchaseItemIds.length) {
    await prisma.purchaseItem.deleteMany({ where: { id: { in: purchaseItemIds } } });
  }
  if (purchaseDocIds.length) {
    await prisma.purchaseDocument.deleteMany({ where: { id: { in: purchaseDocIds } } });
  }
  if (purchaseIds.length) {
    await prisma.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
  }
  if (listingIds.length) {
    await prisma.productListing.deleteMany({ where: { id: { in: listingIds } } });
  }
  if (legoProductIds.length) {
    await prisma.legoProduct.deleteMany({ where: { id: { in: legoProductIds } } });
  }
  if (userIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  inventoryMovementIds.length = 0;
  purchaseItemIds.length = 0;
  purchaseDocIds.length = 0;
  purchaseIds.length = 0;
  listingIds.length = 0;
  legoProductIds.length = 0;
  userIds.length = 0;
}

beforeEach(async () => {
  const user = await prisma.user.create({
    data: {
      email: `user-${randomUUID()}@example.com`,
      passwordHash: "test",
    },
  });
  userId = user.id;
  userIds.push(user.id);
  userToken = jwt.sign({ id: userId, role: "CUSTOMER" }, config.JWT_SECRET, { expiresIn: "1h" });
});

afterEach(async () => {
  await cleanup();
});

// Helper to create a product and listing
async function createProductAndListing(condition: ListingCondition = ListingCondition.NEW): Promise<{ productId: number; listingId: number }> {
  const product = await prisma.legoProduct.create({
    data: {
      setNumber: randomUUID(),
      title: "Test Product",
      theme: "Test",
      ageRecommendation: "8+",
      pieceCount: 100,
    },
  });
  legoProductIds.push(product.id);
  const listing = await prisma.productListing.create({
    data: {
      legoProductId: product.id,
      condition,
      originalPrice: 10.0,
      currentStock: 0,
    },
  });
  listingIds.push(listing.id);
  return { productId: product.id, listingId: listing.id };
}

// Helper to send manual purchase request
async function postManualPurchase(body: any): Promise<Response> {
  return await fetch(`${baseUrl}/purchases/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
    body: JSON.stringify(body),
  });
}

describe("Manual Purchase API", () => {
  it("authenticated POST /purchases/manual returns 201", async () => {
    const body = {
      sourceOrderReference: randomUUID(),
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 1000,
      finalTotalPaid: 1000,
      items: [
        {
          sourceDescription: "Item 1",
          quantity: 1,
          originalGrossUnitCost: 500,
          originalGrossLineTotal: 500,
        },
        {
          sourceDescription: "Item 2",
          quantity: 1,
          originalGrossUnitCost: 500,
          originalGrossLineTotal: 500,
        },
      ],
    };
    const res = await postManualPurchase(body);
    assert.strictEqual(res.status, 201);
    const doc = await res.json();
    trackPurchaseDocument(doc);
  });

  it("successful request with at least TWO PurchaseItems", async () => {
    const body = {
      sourceOrderReference: randomUUID(),
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 2000,
      finalTotalPaid: 2000,
      items: [
        {
          sourceDescription: "Item 1",
          quantity: 2,
          originalGrossUnitCost: 500,
          originalGrossLineTotal: 1000,
        },
        {
          sourceDescription: "Item 2",
          quantity: 2,
          originalGrossUnitCost: 500,
          originalGrossLineTotal: 1000,
        },
      ],
    };
    const res = await postManualPurchase(body);
    assert.strictEqual(res.status, 201);
    const doc = await res.json();
    trackPurchaseDocument(doc);
    assert.ok(Array.isArray(doc.purchaseItems), "purchaseItems should be array");
    assert.strictEqual(doc.purchaseItems.length, 2);
  });

  it("authenticated user owns the PurchaseDocument", async () => {
    const ref = randomUUID();
    const body = {
      sourceOrderReference: ref,
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 1500,
      finalTotalPaid: 1500,
      items: [
        {
          sourceDescription: "Item 1",
          quantity: 1,
          originalGrossUnitCost: 1500,
          originalGrossLineTotal: 1500,
        },
      ],
    };
    const res = await postManualPurchase(body);
    const doc = await res.json();
    assert.strictEqual(doc.importedByUserId, userId);
    trackPurchaseDocument(doc);
  });

  it("request body cannot override importedByUserId", async () => {
    const body = {
      sourceOrderReference: randomUUID(),
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 500,
      finalTotalPaid: 500,
      importedByUserId: 9999,
      items: [
        {
          sourceDescription: "Item 1",
          quantity: 1,
          originalGrossUnitCost: 500,
          originalGrossLineTotal: 500,
        },
      ],
    };
    const res = await postManualPurchase(body);
    const doc = await res.json();
    assert.notEqual(doc.importedByUserId, 9999);
    assert.strictEqual(doc.importedByUserId, userId);
    trackPurchaseDocument(doc);
  });

  it("valid explicit productListingId is persisted", async () => {
    const { listingId } = await createProductAndListing();
    const body = {
      sourceOrderReference: randomUUID(),
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 800,
      finalTotalPaid: 800,
      items: [
        {
          sourceDescription: "Item 1",
          quantity: 1,
          originalGrossUnitCost: 800,
          originalGrossLineTotal: 800,
          productListingId: listingId,
        },
      ],
    };
    const res = await postManualPurchase(body);
    const doc = await res.json();
    assert.strictEqual(doc.purchaseItems[0].productListingId, listingId);
    trackPurchaseDocument(doc);
  });

  it("immediately after creation: stock unchanged, no movement, receivedAt/returnedAt null", async () => {
    const { listingId } = await createProductAndListing();
    const body = {
      sourceOrderReference: randomUUID(),
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 1000,
      finalTotalPaid: 1000,
      items: [
        {
          sourceDescription: "Item 1",
          quantity: 2,
          originalGrossUnitCost: 500,
          originalGrossLineTotal: 1000,
          productListingId: listingId,
        },
      ],
    };
    const res = await postManualPurchase(body);
    const doc = await res.json();
    trackPurchaseDocument(doc);
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listingId } });
    assert.strictEqual(listingAfter?.currentStock, 0);
    const movements = await prisma.inventoryMovement.findMany({ where: { listingId } });
    assert.strictEqual(movements.length, 0);
    assert.strictEqual(doc.purchaseItems[0].receivedAt, null);
    assert.strictEqual(doc.purchaseItems[0].returnedAt, null);
  });

  it("nonexistent explicit productListingId returns 400 and sourceOrderReference not persisted", async () => {
    const badListingId = 9999999;
    const ref = randomUUID();
    const body = {
      sourceOrderReference: ref,
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 600,
      finalTotalPaid: 600,
      items: [
        {
          sourceDescription: "Item 1",
          quantity: 1,
          originalGrossUnitCost: 600,
          originalGrossLineTotal: 600,
          productListingId: badListingId,
        },
      ],
    };
    const res = await postManualPurchase(body);
    assert.strictEqual(res.status, 400);
    const count = await prisma.purchase.count({ where: { sourceOrderReference: ref } });
    assert.strictEqual(count, 0);
  });

  it("quantity 0 and negative quantity return 400", async () => {
    const zeroBody = {
      sourceOrderReference: randomUUID(),
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 0,
      finalTotalPaid: 0,
      items: [
        {
          sourceDescription: "Item 1",
          quantity: 0,
          originalGrossUnitCost: 0,
          originalGrossLineTotal: 0,
        },
      ],
    };
    const negBody = {
      sourceOrderReference: randomUUID(),
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: -100,
      finalTotalPaid: -100,
      items: [
        {
          sourceDescription: "Item 1",
          quantity: -1,
          originalGrossUnitCost: -100,
          originalGrossLineTotal: -100,
        },
      ],
    };
    const resZero = await postManualPurchase(zeroBody);
    assert.strictEqual(resZero.status, 400);
    const resNeg = await postManualPurchase(negBody);
    assert.strictEqual(resNeg.status, 400);
  });

  it("multi-item request containing an invalid item is atomic", async () => {
    const validItem = {
      sourceDescription: "Valid Item",
      quantity: 1,
      originalGrossUnitCost: 500,
      originalGrossLineTotal: 500,
    };
    const invalidItem = {
      sourceDescription: "Invalid Item",
      quantity: 0,
      originalGrossUnitCost: 0,
      originalGrossLineTotal: 0,
    };
    const body = {
      sourceOrderReference: randomUUID(),
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 1000,
      finalTotalPaid: 1000,
      items: [validItem, invalidItem],
    };
    const res = await postManualPurchase(body);
    assert.strictEqual(res.status, 400);
    const count = await prisma.purchase.count({ where: { sourceOrderReference: body.sourceOrderReference } });
    assert.strictEqual(count, 0);
  });

  it("unauthenticated request returns 401", async () => {
    const body = {
      sourceOrderReference: randomUUID(),
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 500,
      finalTotalPaid: 500,
      items: [
        {
          sourceDescription: "Item 1",
          quantity: 1,
          originalGrossUnitCost: 500,
          originalGrossLineTotal: 500,
        },
      ],
    };
    const res = await fetch(`${baseUrl}/purchases/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.strictEqual(res.status, 401);
  });

  it("importHash starts with manual: and different for independent purchases", async () => {
    const body1 = {
      sourceOrderReference: randomUUID(),
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 700,
      finalTotalPaid: 700,
      items: [
        {
          sourceDescription: "Item 1",
          quantity: 1,
          originalGrossUnitCost: 700,
          originalGrossLineTotal: 700,
        },
      ],
    };
    const res1 = await postManualPurchase(body1);
    const doc1 = await res1.json();
    trackPurchaseDocument(doc1);
    assert.ok(doc1.importHash.startsWith("manual:"));
    const body2 = {
      sourceOrderReference: randomUUID(),
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 800,
      finalTotalPaid: 800,
      items: [
        {
          sourceDescription: "Item 1",
          quantity: 1,
          originalGrossUnitCost: 800,
          originalGrossLineTotal: 800,
        },
      ],
    };
    const res2 = await postManualPurchase(body2);
    const doc2 = await res2.json();
    trackPurchaseDocument(doc2);
    assert.notEqual(doc1.importHash, doc2.importHash);
  });

  it("product listing matcher compatibility - unique setNumber", async () => {
    const setNumber = randomUUID();
    const product = await prisma.legoProduct.create({
      data: {
        setNumber,
        title: "Test Product",
        theme: "Test",
        ageRecommendation: "8+",
        pieceCount: 100,
      },
    });
    legoProductIds.push(product.id);
    const listing = await prisma.productListing.create({
      data: {
        legoProductId: product.id,
        condition: ListingCondition.NEW,
        originalPrice: 10.0,
        currentStock: 0,
      },
    });
    listingIds.push(listing.id);
    const body = {
      sourceOrderReference: randomUUID(),
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 1000,
      finalTotalPaid: 1000,
      items: [
        {
          sourceDescription: "Item 1",
          quantity: 1,
          originalGrossUnitCost: 1000,
          originalGrossLineTotal: 1000,
          sourceSetNumber: setNumber,
        },
      ],
    };
    const res = await postManualPurchase(body);
    const doc = await res.json();
    trackPurchaseDocument(doc);
    assert.strictEqual(doc.purchaseItems[0].productListingId, listing.id);
  });

  it("product listing matcher compatibility - ambiguous setNumber", async () => {
    const setNumber = randomUUID();
    const product = await prisma.legoProduct.create({
      data: {
        setNumber,
        title: "Ambiguous Product",
        theme: "Test",
        ageRecommendation: "8+",
        pieceCount: 100,
      },
    });
    legoProductIds.push(product.id);
    const listing1 = await prisma.productListing.create({
      data: {
        legoProductId: product.id,
        condition: ListingCondition.NEW,
        originalPrice: 10.0,
        currentStock: 0,
      },
    });
    const listing2 = await prisma.productListing.create({
      data: {
        legoProductId: product.id,
        condition: ListingCondition.USED_LIKE_NEW,
        originalPrice: 8.0,
        currentStock: 0,
      },
    });
    listingIds.push(listing1.id, listing2.id);
    const body = {
      sourceOrderReference: randomUUID(),
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 900,
      finalTotalPaid: 900,
      items: [
        {
          sourceDescription: "Item 1",
          quantity: 1,
          originalGrossUnitCost: 900,
          originalGrossLineTotal: 900,
          sourceSetNumber: setNumber,
        },
      ],
    };
    const res = await postManualPurchase(body);
    const doc = await res.json();
    trackPurchaseDocument(doc);
    assert.strictEqual(doc.purchaseItems[0].productListingId, null);
  });

  it("product listing matcher compatibility - missing setNumber", async () => {
    const body = {
      sourceOrderReference: randomUUID(),
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 800,
      finalTotalPaid: 800,
      items: [
        {
          sourceDescription: "Item 1",
          quantity: 1,
          originalGrossUnitCost: 800,
          originalGrossLineTotal: 800,
          sourceSetNumber: "NON_EXISTENT_SET",
        },
      ],
    };
    const res = await postManualPurchase(body);
    const doc = await res.json();
    trackPurchaseDocument(doc);
    assert.strictEqual(doc.purchaseItems[0].productListingId, null);
  });

  it("receive workflow compatibility", async () => {
    const { listingId } = await createProductAndListing();
    const body = {
      sourceOrderReference: randomUUID(),
      sourceOrderDate: new Date().toISOString(),
      originalGrossMerchandiseTotal: 1200,
      finalTotalPaid: 1200,
      items: [
        {
          sourceDescription: "Receive Item",
          quantity: 3,
          originalGrossUnitCost: 400,
          originalGrossLineTotal: 1200,
          productListingId: listingId,
        },
      ],
    };
    const res = await postManualPurchase(body);
    const doc = await res.json();
    trackPurchaseDocument(doc);
    const purchaseItemId = doc.purchaseItems[0].id;
    const listingBefore = await prisma.productListing.findUnique({ where: { id: listingId } });
    const stockBefore = listingBefore?.currentStock ?? 0;
    const resRec = await fetch(`${baseUrl}/purchase-items/${purchaseItemId}/receive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(resRec.status, 200);
    const recData = await resRec.json();
    inventoryMovementIds.push(recData.movement.id);
    const listingAfter = await prisma.productListing.findUnique({ where: { id: listingId } });
    assert.strictEqual(listingAfter?.currentStock, stockBefore + 3);
    assert.strictEqual(recData.movement.type, InventoryMovementType.PURCHASE_IN);
    assert.strictEqual(recData.movement.quantityChange, 3);
  });
});
