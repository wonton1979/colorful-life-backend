import assert from "node:assert/strict";
import { beforeEach, afterEach, it } from "node:test";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma/runtime.js";
import { config } from "../config/index.js";
import app from "../app.js";
import { getPurchaseReview, resolveReviewGroup, receiveReviewGroup, amendReviewLine } from "../domain/purchases/purchaseReview.js";
import { receivePurchaseItem } from "../domain/purchases/purchaseItemReceiving.js";

let userId: number, purchaseId: number, listingId: number, productId: number;
let ids: number[];
let extraProducts: number[] = [];
let extraCategoryIds: number[] = [];
let categoryId: number | undefined;
beforeEach(async () => {
  extraProducts = []; extraCategoryIds = []; categoryId = undefined;
  userId = (await prisma.user.create({ data: { email: randomUUID() + "@test.invalid", passwordHash: "test", emailVerified: true, role: "ADMIN" } })).id;
  const listing = await prisma.productListing.create({ data: {
    condition: "NEW", currentStock: 0, originalPrice: "79.99",
    legoProduct: { create: { setNumber: randomUUID(), title: "Review fixture", theme: "Test", ageRecommendation: "8+", pieceCount: 1 } },
  } });
  listingId = listing.id; productId = listing.legoProductId;
  const purchase = await prisma.purchase.create({ data: {
    sourceOrderReference: randomUUID(), purchaseDocuments: { create: {
      partNumber: 1, importHash: randomUUID(), importedByUserId: userId,
      originalGrossMerchandiseTotal: "209.97", finalTotalPaid: "209.97",
      purchaseItems: { create: [1, 2].map((quantity, index) => ({
        sourceDescription: "Same product", externalProductId: "EXACT-ID", sourceLineNumber: index + 1,
        quantity, originalGrossUnitCost: "69.99", originalGrossLineTotal: index ? "139.98" : "69.99",
        finalLineCost: index ? "139.98" : "69.99", finalUnitCost: "69.99",
      })) },
    } },
  }, include: { purchaseDocuments: { include: { purchaseItems: true } } } });
  purchaseId = purchase.id; ids = purchase.purchaseDocuments[0].purchaseItems.map(l => l.id);
});
afterEach(async () => {
  await prisma.inventoryMovement.deleteMany({ where: { performedByUserId: userId } });
  await prisma.purchaseItem.deleteMany({ where: { purchaseDocument: { importedByUserId: userId } } });
  await prisma.purchaseDocument.deleteMany({ where: { importedByUserId: userId } });
  await prisma.purchase.deleteMany({ where: { purchaseDocuments: { none: {} }, id: purchaseId } });
  await prisma.productListing.deleteMany({ where: { legoProductId: { in: [productId, ...extraProducts] } } });
  await prisma.legoProduct.deleteMany({ where: { id: { in: [productId, ...extraProducts] } } });
  if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
  if (extraCategoryIds.length) await prisma.category.deleteMany({ where: { id: { in: extraCategoryIds } } });
  await prisma.user.delete({ where: { id: userId } });
});
const review = () => getPurchaseReview(userId, purchaseId);
async function matched() {
  const r = await review();
  return resolveReviewGroup(userId, purchaseId, r.groups[0].id, { revision: r.revision, productListingId: listingId });
}
it("groups exact identities 1 + 2 without merging source lines or costs", async () => {
  const r = await review();
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].quantity, 3);
  assert.equal(r.groups[0].unitCost, "69.990000");
  assert.equal(r.totalCost, "209.97");
  assert.deepEqual(r.groups[0].sourceItemIds, ids);
  assert.equal(await prisma.inventoryMovement.count({ where: { listingId } }), 0);
});
it("uses exact set fallback and isolates unidentified/different products", async () => {
  await prisma.purchaseItem.updateMany({ where: { id: { in: ids } }, data: { externalProductId: null, sourceSetNumber: "75446" } });
  assert.equal((await review()).groups.length, 1);
  await prisma.purchaseItem.update({ where: { id: ids[1] }, data: { sourceSetNumber: "75447" } });
  assert.equal((await review()).groups.length, 2);
  await prisma.purchaseItem.updateMany({ where: { id: { in: ids } }, data: { sourceSetNumber: null } });
  assert.equal((await review()).groups.length, 2);
});
it("never groups across orders", async () => {
  const second = await prisma.purchase.create({ data: { sourceOrderReference: randomUUID() } });
  try {
    const doc = (await review()).purchase.purchaseDocuments[0];
    await prisma.purchaseDocument.update({ where: { id: doc.id }, data: { purchaseId: second.id } });
    await assert.rejects(review, { status: 404 });
    assert.equal((await getPurchaseReview(userId, second.id)).groups[0].quantity, 3);
    await prisma.purchaseDocument.update({ where: { id: doc.id }, data: { purchaseId } });
  } finally { await prisma.purchase.delete({ where: { id: second.id } }); }
});
it("amends one source line, recalculates document totals and weighted cost", async () => {
  const r = await review();
  const next = await amendReviewLine(userId, purchaseId, ids[1], { revision: r.revision,
    sourceDescription: "Corrected", sourceSetNumber: "75446", quantity: 2, originalGrossUnitCost: "59.99" });
  assert.equal(next.groups[0].quantity, 3);
  assert.equal(next.groups[0].totalCost, "189.97");
  assert.equal(next.groups[0].costKind, "WEIGHTED_AVERAGE");
  assert.equal(next.groups[0].unitCost, "63.323333");
  assert.equal(next.purchase.purchaseDocuments[0].originalGrossMerchandiseTotal.toFixed(2), "189.97");
  assert.equal(next.groups[0].lines[0].originalGrossUnitCost.toFixed(2), "69.99");
});
it("reallocates shipping/discount exactly and preserves received cost history", async () => {
  const docId = (await review()).purchase.purchaseDocuments[0].id;
  await prisma.purchaseDocument.update({ where: { id: docId }, data: { shippingTotal: "1.01", discountTotal: "0.03" } });
  let r = await review();
  r = await amendReviewLine(userId, purchaseId, ids[0], { revision: r.revision, sourceDescription: "Line", sourceSetNumber: null, quantity: 2 });
  const doc = r.purchase.purchaseDocuments[0];
  assert.equal(doc.finalTotalPaid.toFixed(2), "280.94");
  assert.equal(doc.purchaseItems.reduce((s, l) => s + Number(l.allocatedShipping), 0).toFixed(2), "1.01");
  await matched();
  await receivePurchaseItem(userId, ids[0]);
  r = await review();
  await assert.rejects(() => amendReviewLine(userId, purchaseId, ids[1], { revision: r.revision, sourceDescription: "Line", sourceSetNumber: null, quantity: 3 }), { status: 409 });
});
it("rejects protected fields, invalid amendments and stale revisions", async () => {
  const r = await review();
  for (const extra of [{ receivedAt: null }, { productListingId: listingId }, { quantity: 0 }, { finalLineCost: "1" }, { originalGrossUnitCost: "NaN" }]) {
    await assert.rejects(() => amendReviewLine(userId, purchaseId, ids[0], { revision: r.revision, sourceDescription: "Line", sourceSetNumber: null, ...extra }));
  }
  await matched();
  await assert.rejects(() => resolveReviewGroup(userId, purchaseId, ids[0], { revision: r.revision, productListingId: null }), { status: 409 });
});
it("resolves, reassigns and clears an entire group; invalid targets leave all unchanged", async () => {
  let r = await matched();
  assert(r.groups[0].lines.every(l => l.productListingId === listingId));
  const other = await prisma.productListing.create({ data: { legoProductId: productId, condition: "NEW", originalPrice: "50", currentStock: 0 } });
  r = await resolveReviewGroup(userId, purchaseId, ids[0], { revision: r.revision, productListingId: other.id });
  assert(r.groups[0].lines.every(l => l.productListingId === other.id));
  await assert.rejects(() => resolveReviewGroup(userId, purchaseId, ids[0], { revision: r.revision, productListingId: 2147483647 }), { status: 400 });
  r = await resolveReviewGroup(userId, purchaseId, ids[0], { revision: r.revision, productListingId: null });
  assert(r.groups[0].lines.every(l => l.productListingId === null));
});
it("receives 3 authoritatively with two movements and rejects repeats or received edits", async () => {
  const r = await matched();
  const received = await receiveReviewGroup(userId, purchaseId, ids[0], { revision: r.revision });
  assert(received.groups[0].lines.every(l => l.receivedAt));
  assert.equal((await prisma.productListing.findUniqueOrThrow({ where: { id: listingId } })).currentStock, 3);
  assert.deepEqual((await prisma.inventoryMovement.findMany({ where: { listingId }, orderBy: { id: "asc" } })).map(m => [m.type, m.quantityChange]), [["PURCHASE_IN", 1], ["PURCHASE_IN", 2]]);
  await assert.rejects(() => receiveReviewGroup(userId, purchaseId, ids[0], { revision: received.revision }), { status: 409 });
  await assert.rejects(() => resolveReviewGroup(userId, purchaseId, ids[0], { revision: received.revision, productListingId: null }), { status: 409 });
  await assert.rejects(() => amendReviewLine(userId, purchaseId, ids[0], { revision: received.revision, sourceDescription: "Changed", sourceSetNumber: null }), { status: 409 });
});
it("rolls back the first member's stock/movement when a later member fails", async () => {
  await matched();
  await prisma.purchaseItem.update({ where: { id: ids[1] }, data: { quantity: -1 } });
  const r = await review();
  await assert.rejects(() => receiveReviewGroup(userId, purchaseId, ids[0], { revision: r.revision }));
  assert.equal((await prisma.productListing.findUniqueOrThrow({ where: { id: listingId } })).currentStock, 0);
  assert.equal(await prisma.inventoryMovement.count({ where: { listingId } }), 0);
  assert((await review()).groups[0].lines.every(l => !l.receivedAt));
});
it("serializes duplicate group requests, amendment/receive and resolution/receive races", async () => {
  const r = await matched();
  const outcomes = await Promise.allSettled([
    receiveReviewGroup(userId, purchaseId, ids[0], { revision: r.revision }),
    receiveReviewGroup(userId, purchaseId, ids[0], { revision: r.revision }),
    amendReviewLine(userId, purchaseId, ids[0], { revision: r.revision, sourceDescription: "Changed", sourceSetNumber: null, quantity: 9 }),
    resolveReviewGroup(userId, purchaseId, ids[0], { revision: r.revision, productListingId: null }),
  ]);
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  const latest = await review();
  const stock = (await prisma.productListing.findUniqueOrThrow({ where: { id: listingId } })).currentStock;
  assert.equal(stock, latest.groups[0].state === "RECEIVED" ? 3 : 0);
});
it("rejects unresolved receiving and hides inaccessible purchases", async () => {
  const r = await review();
  await assert.rejects(() => receiveReviewGroup(userId, purchaseId, ids[0], { revision: r.revision }), { status: 400 });
  await assert.rejects(() => getPurchaseReview(userId + 100000, purchaseId), { status: 404 });
});
it("enforces ADMIN at review, resolution, amendment, receive and return HTTP boundaries", async () => {
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const base = "http://127.0.0.1:" + address.port;
  try {
    const token = (role: string) => jwt.sign({ id: userId, role }, config.JWT_SECRET);
    for (const [method, path] of [["GET", "/purchases/" + purchaseId + "/review"], ["PATCH", "/purchases/" + purchaseId + "/review/items/" + ids[0]], ["PATCH", "/purchases/" + purchaseId + "/review/groups/" + ids[0] + "/listing"], ["POST", "/purchases/" + purchaseId + "/review/groups/" + ids[0] + "/receive"], ["POST", "/purchase-items/" + ids[0] + "/receive"], ["POST", "/purchase-items/" + ids[0] + "/return"]]) {
      assert.equal((await fetch(base + path, { method, headers: { Authorization: "Bearer " + token("CUSTOMER") } })).status, 403);
    }
    const response = await fetch(base + "/purchases/" + purchaseId + "/review", { headers: { Authorization: "Bearer " + token("ADMIN") } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).groups[0].quantity, 3);
    const headers = { Authorization: "Bearer " + token("ADMIN"), "Content-Type": "application/json" };
    const r = await review();
    const resolved = await fetch(base + "/purchases/" + purchaseId + "/review/groups/" + ids[0] + "/listing",
      { method: "PATCH", headers, body: JSON.stringify({ revision: r.revision, productListingId: listingId }) });
    assert.equal(resolved.status, 200);
    const next = await resolved.json();
    assert.equal((await fetch(base + "/purchases/" + purchaseId + "/review/groups/" + ids[0] + "/receive",
      { method: "POST", headers, body: JSON.stringify({ revision: next.revision, quantity: 100 }) })).status, 400);
    assert.equal((await fetch(base + "/purchases/" + purchaseId + "/review/groups/" + ids[0] + "/receive",
      { method: "POST", headers, body: JSON.stringify({ revision: next.revision }) })).status, 200);
    for (const currentStock of [3, undefined]) {
      assert.equal((await fetch(base + "/purchases/" + purchaseId + "/review/listings", {
        method: "POST", headers, body: JSON.stringify({ existingProductId: productId, condition: "NEW", originalPrice: 30, currentStock }),
      })).status, 400);
    }
    const created = await fetch(base + "/purchases/" + purchaseId + "/review/listings", {
      method: "POST", headers, body: JSON.stringify({ existingProductId: productId, condition: "USED_LIKE_NEW", originalPrice: 30, currentStock: 0 }),
    });
    assert.equal(created.status, 400);
    const product = await prisma.legoProduct.findUniqueOrThrow({ where: { id: productId } });
    const search = await fetch(base + "/purchases/" + purchaseId + "/review/products?q=" + encodeURIComponent(product.setNumber), { headers });
    assert.equal(search.status, 200);
    assert.equal((await search.json())[0].id, productId);
    categoryId = (await prisma.category.create({ data: { name: "Review creation " + randomUUID() } })).id;
    const newProductRequest = { setNumber: randomUUID(), title: "New reviewed product", theme: "Test", categoryId,
      ageRecommendation: "8+", pieceCount: 12, condition: "NEW", originalPrice: 40, currentStock: 0 };
    const createdProduct = await fetch(base + "/purchases/" + purchaseId + "/review/listings", {
      method: "POST", headers, body: JSON.stringify(newProductRequest),
    });
    assert.equal(createdProduct.status, 201);
    const result = await createdProduct.json(); extraProducts.push(result.legoProductId);
    assert.equal(result.currentStock, 0);
    assert.equal(result.category.id, categoryId);
    assert.equal(await prisma.inventoryMovement.count({ where: { listingId: result.id } }), 0);
    assert.equal((await fetch(base + "/purchases/" + purchaseId + "/review/listings", {
      method: "POST", headers, body: JSON.stringify(newProductRequest),
    })).status, 409);

    const existingProductCategory = await prisma.category.create({ data: { name: "Review existing product " + randomUUID() } });
    extraCategoryIds.push(existingProductCategory.id);
    const existingProduct = await prisma.legoProduct.create({ data: {
      setNumber: randomUUID(), title: "Review existing listing", theme: "Test", ageRecommendation: "8+", pieceCount: 12,
      categoryId: existingProductCategory.id,
    } });
    extraProducts.push(existingProduct.id);
    const createdExisting = await fetch(base + "/purchases/" + purchaseId + "/review/listings", {
      method: "POST", headers,
      body: JSON.stringify({ existingProductId: existingProduct.id, condition: "NEW", originalPrice: 20, currentStock: 0 }),
    });
    assert.equal(createdExisting.status, 201);
    const existingListing = await createdExisting.json();
    assert.equal(existingListing.isFeatureProduct, true);
    const createdAgain = await fetch(base + "/purchases/" + purchaseId + "/review/listings", {
      method: "POST", headers,
      body: JSON.stringify({ existingProductId: existingProduct.id, condition: "USED_LIKE_NEW", originalPrice: 15, currentStock: 0 }),
    });
    assert.equal(createdAgain.status, 400);
    assert.equal((await prisma.productListing.findUniqueOrThrow({ where: { id: existingListing.id } })).isFeatureProduct, true);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});
