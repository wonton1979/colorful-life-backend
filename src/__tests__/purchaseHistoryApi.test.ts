import assert from "node:assert";
import type { Server } from "node:http";
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import { prisma } from "../prisma/runtime.js";
import app from "../app.js";

// ---------- Utility helpers ------------------------------------------------
// Same helpers used in the import‑API tests – copied for consistency.
// They are kept local to this file to avoid accidental reuse of shared state.

/**
 * Start the Express app on a random available port and return the listening
 * server and the base URL.
 */
async function startServer(): Promise<{ server: Server; url: string }> {
  const server = app.listen(0);
  return new Promise((resolve, reject) => {
    server.once("listening", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to obtain server address"));
        return;
      }
      const url = `http://localhost:${address.port}`;
      resolve({ server, url });
    });
  });
}

/**
 * Create a fresh user via the public auth API and return the bearer token
 * plus the internal numeric ID.
 */
async function createTestUser(url: string): Promise<{ token: string; userId: number }> {
  const email = `history-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = "Test1234";
  const signupRes = await fetch(`${url}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.strictEqual(signupRes.status, 201, "Signup should succeed");
  const signupBody = await signupRes.json();
  const token = signupBody.token;
  // Decode token payload to obtain the user ID
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString("utf8")
  );
  const userId = payload.id as number;
  return { token, userId };
}

/**
 * Cleanup any data created during a test run for a specific user.
 * Deletes purchase items, documents and the owning user.
 */
async function cleanup(userId: number): Promise<void> {
  const purchaseDocs = await prisma.purchaseDocument.findMany({ where: { importedByUserId: userId } });
  const docIds = purchaseDocs.map((d) => d.id);
  const purchaseIds = purchaseDocs.map((d) => d.purchaseId);
  if (docIds.length) {
    await prisma.purchaseItem.deleteMany({ where: { purchaseDocumentId: { in: docIds } } });
    await prisma.purchaseDocument.deleteMany({ where: { id: { in: docIds } } });
  }
  if (purchaseIds.length) {
    const remainingDocs = await prisma.purchaseDocument.findMany({ where: { purchaseId: { in: purchaseIds } } });
    const remainingPurchaseIds = new Set(remainingDocs.map((d) => d.purchaseId));
    const idsToDelete = purchaseIds.filter((id) => !remainingPurchaseIds.has(id));
    if (idsToDelete.length) {
      await prisma.purchase.deleteMany({ where: { id: { in: idsToDelete } } });
    }
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}

/**
 * Helper to create a purchase with the specified attributes.
 * Returns the created purchase ID.
 */
async function createPurchase(
  userId: number,
  opts: {
    reference?: string;
    orderDate?: Date;
    docs?: Array<{
      partNumber: number;
      importHash: string;
      items?: Array<{
        sourceLineNumber: number;
        sourceDescription: string;
        quantity: number;
        finalUnitCost: number;
      }>
    }>;
  }
): Promise<number> {
  const reference = opts.reference ?? `ref-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const purchase = await prisma.purchase.create({
    data: {
      sourceOrderReference: reference,
      sourceOrderDate: opts.orderDate ?? undefined,
      purchaseDocuments: {
        create: opts.docs?.map((d) => ({
          partNumber: d.partNumber,
          importHash: d.importHash,
          importedByUserId: userId,
          originalGrossMerchandiseTotal: 0,
          shippingTotal: 0,
          discountTotal: 0,
          finalTotalPaid: 0,
          purchaseItems: {
            create: d.items?.map((i) => ({
              sourceLineNumber: i.sourceLineNumber,
              sourceDescription: i.sourceDescription,
              quantity: i.quantity,
              finalUnitCost: i.finalUnitCost,
              // other required fields with placeholder values
              sourceSetNumber: null,
              externalProductId: null,
              productListingId: null,
              originalGrossUnitCost: 0,
              originalGrossLineTotal: 0,
              allocatedShipping: 0,
              allocatedDiscount: 0,
              finalLineCost: 0,
            }))
          }
        }))
      }
    }
  });
  return purchase.id;
}

// ---------------------------------------------------------------------------

describe("Purchase History API", () => {
  let server: Server;
  let url: string;
  let token: string;
  let userId: number;

  before(async () => {
    const { server: srv, url: u } = await startServer();
    server = srv;
    url = u;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(async () => {
    const user = await createTestUser(url);
    token = user.token;
    userId = user.userId;
  });

  afterEach(async () => {
    await cleanup(userId);
  });

  // 1. Authentication required
  it("requires authentication", async () => {
    const res = await fetch(`${url}/purchases`);
    assert.strictEqual(res.status, 401);
  });

  // 2. Authenticated user receives own purchase history
  it("returns own purchases", async () => {
    // create two purchases for this user
    await createPurchase(userId, {
      docs: [
        { partNumber: 1, importHash: `hash-${Math.random()}` },
      ],
    });
    await createPurchase(userId, {
      docs: [
        { partNumber: 2, importHash: `hash-${Math.random()}` },
      ],
    });
    const res = await fetch(`${url}/purchases`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert(Array.isArray(body.purchases));
    assert(body.purchases.length >= 2);
  });

  // 3. Exclude other users' purchases
  it("excludes purchases belonging to other users", async () => {
    // create purchase for another user
    const otherUser = await createTestUser(url);
    await createPurchase(otherUser.userId, {
      docs: [
        { partNumber: 3, importHash: `hash-${Math.random()}` },
      ],
    });
    const res = await fetch(`${url}/purchases`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    assert.strictEqual(body.purchases.length, 0);
    // cleanup other user
    await cleanup(otherUser.userId);
  });

  // 4. Pagination
  it("supports pagination", async () => {
    // create 5 purchases
    for (let i = 0; i < 5; i++) {
      await createPurchase(userId, {
        docs: [{ partNumber: i + 1, importHash: `hash-${Math.random()}` }],
      });
    }
    const resPage1 = await fetch(`${url}/purchases?page=1&limit=2`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body1 = await resPage1.json();
    assert.strictEqual(body1.pagination.page, 1);
    assert.strictEqual(body1.pagination.limit, 2);
    assert.strictEqual(body1.pagination.total, 5);
    assert.strictEqual(body1.pagination.totalPages, 3);
    assert.strictEqual(body1.purchases.length, 2);
    const resPage2 = await fetch(`${url}/purchases?page=2&limit=2`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body2 = await resPage2.json();
    assert.strictEqual(body2.purchases.length, 2);
  });

  // 5. Invalid pagination params
  it("returns 400 for invalid pagination parameters", async () => {
    const cases = [
      { query: "page=0", status: 400 },
      { query: "page=-1", status: 400 },
      { query: "page=abc", status: 400 },
      { query: "page=1abc", status: 400 },
      { query: "limit=0", status: 400 },
      { query: "limit=101", status: 400 },
      { query: "limit=xyz", status: 400 },
      { query: "limit=10x", status: 400 },
    ];
    for (const c of cases) {
      const res = await fetch(`${url}/purchases?${c.query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, c.status, `Query ${c.query}`);
    }
  });

  // 6. Ordering by sourceOrderDate desc, id desc
  it("orders purchases by sourceOrderDate desc then id desc", async () => {
    const commonDate = new Date("2023-01-01");
    const id1 = await createPurchase(userId, {
      orderDate: commonDate,
      docs: [{ partNumber: 1, importHash: `hash-${Math.random()}` }],
    });
    const id2 = await createPurchase(userId, {
      orderDate: commonDate,
      docs: [{ partNumber: 1, importHash: `hash-${Math.random()}` }],
    });
    const res = await fetch(`${url}/purchases`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    // The newest id should come first because id desc
    assert.strictEqual(body.purchases[0].id, Math.max(id1, id2));
    assert.strictEqual(body.purchases[1].id, Math.min(id1, id2));
  });

  // NEW: Complete list ordering – sourceOrderDate DESC then id DESC
  it("orders list by sourceOrderDate DESC then id DESC", async () => {
    // Create newer date purchase
    const newerDate = new Date("2024-01-01");
    const newerId = await createPurchase(userId, {
      orderDate: newerDate,
      docs: [{ partNumber: 10, importHash: `hash-${Math.random()}` }],
    });
    // Create two older date purchases
    const olderDate = new Date("2023-01-01");
    const olderId1 = await createPurchase(userId, {
      orderDate: olderDate,
      docs: [{ partNumber: 20, importHash: `hash-${Math.random()}` }],
    });
    const olderId2 = await createPurchase(userId, {
      orderDate: olderDate,
      docs: [{ partNumber: 20, importHash: `hash-${Math.random()}` }],
    });
    const res = await fetch(`${url}/purchases`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    // Expected order: newer, older (higher id), older (lower id)
    assert.strictEqual(body.purchases[0].id, newerId);
    const olderIds = [olderId1, olderId2];
    assert(olderIds.includes(body.purchases[1].id));
    assert(olderIds.includes(body.purchases[2].id));
    // Verify secondary ordering by id descending
    assert.strictEqual(body.purchases[1].id, Math.max(olderId1, olderId2));
    assert.strictEqual(body.purchases[2].id, Math.min(olderId1, olderId2));
  });

  // 7. GET /purchases/:id returns owned purchase
  it("returns purchase detail for own purchase", async () => {
    const purchaseId = await createPurchase(userId, {
      docs: [{ partNumber: 1, importHash: `hash-${Math.random()}` }],
    });
    const res = await fetch(`${url}/purchases/${purchaseId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.id, purchaseId);
  });

  // 8. Detail includes PurchaseDocuments
  it("purchase detail includes documents", async () => {
    const purchaseId = await createPurchase(userId, {
      docs: [
        { partNumber: 1, importHash: `hash-${Math.random()}` },
        { partNumber: 2, importHash: `hash-${Math.random()}` },
      ],
    });
    const res = await fetch(`${url}/purchases/${purchaseId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    assert(Array.isArray(body.purchaseDocuments));
    assert.strictEqual(body.purchaseDocuments.length, 2);
  });

  // 9. Detail includes PurchaseItems
  it("purchase detail includes items", async () => {
    const purchaseId = await createPurchase(userId, {
      docs: [
        {
          partNumber: 1,
          importHash: `hash-${Math.random()}`,
          items: [
            {
              sourceLineNumber: 1,
              sourceDescription: "desc",
              quantity: 1,
              finalUnitCost: 10,
            },
          ],
        },
      ],
    });
    const res = await fetch(`${url}/purchases/${purchaseId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    assert(Array.isArray(body.purchaseDocuments));
    assert(body.purchaseDocuments[0].purchaseItems.length > 0);
  });

  // 10. Document ordering by partNumber asc
  it("orders documents by partNumber asc", async () => {
    const purchaseId = await createPurchase(userId, {
      docs: [
        { partNumber: 2, importHash: `hash-${Math.random()}` },
        { partNumber: 1, importHash: `hash-${Math.random()}` },
      ],
    });
    const res = await fetch(`${url}/purchases/${purchaseId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    assert(body.purchaseDocuments[0].partNumber === 1);
    assert(body.purchaseDocuments[1].partNumber === 2);
  });

  // 11. Item ordering by sourceLineNumber asc
  it("orders items by sourceLineNumber asc", async () => {
    const purchaseId = await createPurchase(userId, {
      docs: [
        {
          partNumber: 1,
          importHash: `hash-${Math.random()}`,
          items: [
            {
              sourceLineNumber: 2,
              sourceDescription: "desc2",
              quantity: 1,
              finalUnitCost: 10,
            },
            {
              sourceLineNumber: 1,
              sourceDescription: "desc1",
              quantity: 1,
              finalUnitCost: 10,
            },
          ],
        },
      ],
    });
    const res = await fetch(`${url}/purchases/${purchaseId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const items = body.purchaseDocuments[0].purchaseItems;
    assert(items[0].sourceLineNumber === 1);
    assert(items[1].sourceLineNumber === 2);
  });

  // 12. Invalid purchase id
  it("returns 400 for invalid purchase id", async () => {
    const cases = ["abc", "12abc", "0", "-1"];
    for (const c of cases) {
      const res = await fetch(`${url}/purchases/${c}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 400, `ID ${c} should return 400`);
    }
  });

  // 13. Non‑existent purchase id
  it("returns 404 for non‑existent purchase", async () => {
    const res = await fetch(`${url}/purchases/999999`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.status, 404);
  });

  // NEW: Other user's purchase detail – should return 404
  it("returns 404 when accessing another user's purchase detail", async () => {
    // Create User B and a purchase for B
    const userB = await createTestUser(url);
    const purchaseId = await createPurchase(userB.userId, {
      docs: [{ partNumber: 5, importHash: `hash-${Math.random()}` }],
    });
    const res = await fetch(`${url}/purchases/${purchaseId}`, {
      headers: { Authorization: `Bearer ${token}` }, // User A token
    });
    assert.strictEqual(res.status, 404);
    // Clean up User B data
    await cleanup(userB.userId);
  });

  // 14. Security – each user only sees their own documents/items
  it("enforces per‑document ownership in shared purchase", async () => {
    // create two users
    const userA = await createTestUser(url);
    const userB = await createTestUser(url);
    // purchase with two documents owned by each user
    const purchaseId = await prisma.purchase.create({
      data: {
        sourceOrderReference: `shared-${Math.random()}`,
        purchaseDocuments: {
          create: [
            {
              partNumber: 1,
              importHash: `hash-${Math.random()}`,
              importedByUserId: userA.userId,
              originalGrossMerchandiseTotal: 0,
              shippingTotal: 0,
              discountTotal: 0,
              finalTotalPaid: 0,
              purchaseItems: {
                create: [
                  {
                    sourceLineNumber: 1,
                    sourceDescription: "itemA",
                    quantity: 1,
                    finalUnitCost: 5,
                    sourceSetNumber: null,
                    externalProductId: null,
                    productListingId: null,
                    originalGrossUnitCost: 0,
                    originalGrossLineTotal: 0,
                    allocatedShipping: 0,
                    allocatedDiscount: 0,
                    finalLineCost: 0,
                  },
                ],
              },
            },
            {
              partNumber: 2,
              importHash: `hash-${Math.random()}`,
              importedByUserId: userB.userId,
              originalGrossMerchandiseTotal: 0,
              shippingTotal: 0,
              discountTotal: 0,
              finalTotalPaid: 0,
              purchaseItems: {
                create: [
                  {
                    sourceLineNumber: 1,
                    sourceDescription: "itemB",
                    quantity: 1,
                    finalUnitCost: 5,
                    sourceSetNumber: null,
                    externalProductId: null,
                    productListingId: null,
                    originalGrossUnitCost: 0,
                    originalGrossLineTotal: 0,
                    allocatedShipping: 0,
                    allocatedDiscount: 0,
                    finalLineCost: 0,
                  },
                ],
              },
            },
          ],
        },
      },
    });
    const sharedPurchaseId = purchaseId.id;
    // User A request
    const resA = await fetch(`${url}/purchases/${sharedPurchaseId}`, {
      headers: { Authorization: `Bearer ${userA.token}` },
    });
    const bodyA = await resA.json();
    assert.strictEqual(bodyA.purchaseDocuments.length, 1);
    assert.strictEqual(bodyA.purchaseDocuments[0].partNumber, 1);
    assert.strictEqual(bodyA.purchaseDocuments[0].purchaseItems[0].sourceDescription, "itemA");
    // User B request
    const resB = await fetch(`${url}/purchases/${sharedPurchaseId}`, {
      headers: { Authorization: `Bearer ${userB.token}` },
    });
    const bodyB = await resB.json();
    assert.strictEqual(bodyB.purchaseDocuments.length, 1);
    assert.strictEqual(bodyB.purchaseDocuments[0].partNumber, 2);
    assert.strictEqual(bodyB.purchaseDocuments[0].purchaseItems[0].sourceDescription, "itemB");
    // Cleanup both users
    await cleanup(userA.userId);
    await cleanup(userB.userId);
  });
});
