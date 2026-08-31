import assert from "node:assert";
import type { Server } from "node:http";
import { describe, it, before, after, afterEach } from "node:test";
import { prisma } from "../prisma/runtime.js";
import app from "../app.js";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { randomUUID } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/client";
import type { UserRole } from "../generated/prisma-client/enums.js";

// Arrays for cleanup
  const userIdsForCleanup: number[] = [];
  const expenseIdsForCleanup: number[] = [];
  const listingIdsForCleanup: number[] = [];
  const legoProductIdsForCleanup: number[] = [];

/** Helper to start the Express app on an OS‑assigned port. */
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

/** Record the user ID extracted from a JWT so it can be cleaned up after each test. */
function recordUserIdFromToken(token: string, cleanupArray: number[]) {
  const payload = jwt.verify(token, config.JWT_SECRET) as any;
  cleanupArray.push(payload.id as number);
}

/** Helper to create a user via Prisma. */
async function createUserWithRole(email: string, role: UserRole) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: "hashed",
      emailVerified: true,
      role,
      addresses: {
        create: {
          recipientName: "Test User",
          line1: "123 Test St",
          city: "Testville",
          postcode: "12345",
          countryCode: "US",
          isDefaultBilling: true,
        },
      },
    },
    include: { addresses: true },
  });
  return user;
}

/** Helper to sign a token for a user. */
function signToken(userId: number, role: string): string {
  return jwt.sign({ id: userId, role }, config.JWT_SECRET, { expiresIn: "1h" });
}

describe("Business Expenses HTTP Integration", () => {
  let server: Server;
  let url: string;
  let adminToken: string;
  let adminId: number;
  before(async () => {
    const { server: srv, url: u } = await startServer();
    server = srv;
    url = u;
    // Create an admin user via Prisma
    const admin = await createUserWithRole(`admin-${randomUUID()}@example.com`, "ADMIN");
    adminToken = signToken(admin.id, "ADMIN");
    // Do not add the admin to per-test cleanup – it is removed in the after() hook
    adminId = admin.id;
  });
  after(async () => {
    // Clean up the shared admin user that was created in the suite's before hook
    if (adminId) {
      await prisma.user.deleteMany({ where: { id: { in: [adminId] } } });
    }
    await prisma.$disconnect();
    server.close();
  });
  afterEach(async () => {
    if (expenseIdsForCleanup.length) {
      await prisma.businessExpense.deleteMany({ where: { id: { in: expenseIdsForCleanup } } });
      expenseIdsForCleanup.length = 0;
    }
    if (userIdsForCleanup.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIdsForCleanup } } });
      userIdsForCleanup.length = 0;
    }
    if (listingIdsForCleanup.length) {
      await prisma.inventoryMovement.deleteMany({
        where: { listingId: { in: listingIdsForCleanup } },
      });
      await prisma.productListing.deleteMany({
        where: { id: { in: listingIdsForCleanup } },
      });
      listingIdsForCleanup.length = 0;
    }
    if (legoProductIdsForCleanup.length) {
      await prisma.legoProduct.deleteMany({
        where: { id: { in: legoProductIdsForCleanup } },
      });
      legoProductIdsForCleanup.length = 0;
    }
  });

  /** Helper to create a business expense via the API. */
  async function postExpense(body: any): Promise<Response> {
    return await fetch(`${url}/business-expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(body),
    });
  }

  it("ADMIN can create a valid expense", async () => {
    const body = {
      category: "PACKAGING",
      amount: 12.5,
      incurredAt: "2026-08-29T12:00:00.000Z",
      description: "Shipping boxes and packing tape",
    };
    const res = await postExpense(body);
    assert.strictEqual(res.status, 201);
    const expense = await res.json();
    expenseIdsForCleanup.push(expense.id);
    assert.strictEqual(expense.category, body.category);
    assert.strictEqual(parseFloat(expense.amount), body.amount);
    assert.strictEqual(expense.incurredAt, body.incurredAt);
    assert.strictEqual(expense.description, body.description.trim());
    assert.strictEqual(expense.sourceType, "MANUAL");
    assert.strictEqual(expense.sourceId, null);
  });

  it("zero amount rejected", async () => {
    const body = { category: "PACKAGING", amount: 0, incurredAt: "2026-08-29T12:00:00.000Z", description: "desc" };
    const res = await postExpense(body);
    assert.strictEqual(res.status, 400);
  });

  it("negative amount rejected", async () => {
    const body = { category: "PACKAGING", amount: -5, incurredAt: "2026-08-29T12:00:00.000Z", description: "desc" };
    const res = await postExpense(body);
    assert.strictEqual(res.status, 400);
  });

  it("invalid category rejected", async () => {
    const body = { category: "FOOD", amount: 10, incurredAt: "2026-08-29T12:00:00.000Z", description: "desc" };
    const res = await postExpense(body);
    assert.strictEqual(res.status, 400);
  });

  it("invalid incurredAt rejected", async () => {
    const body = { category: "PACKAGING", amount: 10, incurredAt: "not-a-date", description: "desc" };
    const res = await postExpense(body);
    assert.strictEqual(res.status, 400);
  });

  it("authenticated non-ADMIN rejected", async () => {
    const user = await createUserWithRole(`cust-${randomUUID()}@example.com`, "CUSTOMER");
    const token = signToken(user.id, "CUSTOMER");
    // Add temporary customer user to per-test cleanup
    userIdsForCleanup.push(user.id);
    const res = await fetch(`${url}/business-expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ category: "PACKAGING", amount: 10, incurredAt: "2026-08-29T12:00:00.000Z", description: "desc" }),
    });
    assert.strictEqual(res.status, 403);
  });

  it("unauthenticated request rejected", async () => {
    const res = await fetch(`${url}/business-expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "PACKAGING", amount: 10, incurredAt: "2026-08-29T12:00:00.000Z", description: "desc" }),
    });
    assert.strictEqual(res.status, 401);
  });

  it("ADMIN can list expenses ordered by incurredAt desc", async () => {
    const exp1 = {
      category: "PACKAGING",
      amount: 10,
      incurredAt: "2026-08-28T12:00:00.000Z",
      description: "exp1",
    };
    const exp2 = {
      category: "SHIPPING",
      amount: 20,
      incurredAt: "2026-08-29T12:00:00.000Z",
      description: "exp2",
    };
    const r1 = await postExpense(exp1);
    const r2 = await postExpense(exp2);
    const d1 = await r1.json();
    const d2 = await r2.json();
    expenseIdsForCleanup.push(d1.id, d2.id);
    const listRes = await fetch(`${url}/business-expenses`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(listRes.status, 200);
    const list = await listRes.json();
    assert.ok(Array.isArray(list));
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].incurredAt, exp2.incurredAt);
    assert.strictEqual(list[1].incurredAt, exp1.incurredAt);
  });

  it("expense creation has no inventory/order side effects", async () => {
    const product = await prisma.legoProduct.create({
      data: {
        setNumber: `EXP-${randomUUID()}`,
        title: "Business expense isolation listing",
        theme: "TEST",
        ageRecommendation: "8+",
        pieceCount: 1,
        productListings: {
          create: {
            condition: "NEW",
            originalPrice: new Decimal("10.00"),
            salePrice: new Decimal("10.00"),
            currentStock: 1,
            active: true,
          },
        },
      },
      include: { productListings: true },
    });
    const listingId = product.productListings[0].id;
    legoProductIdsForCleanup.push(product.id);
    listingIdsForCleanup.push(listingId);
    const beforeCount = await prisma.inventoryMovement.count({
      where: { listingId },
    });
    const res = await postExpense({ category: "PACKAGING", amount: 5, incurredAt: "2026-08-29T12:00:00.000Z", description: "none" });
    assert.strictEqual(res.status, 201);
    const expense = await res.json();
    expenseIdsForCleanup.push(expense.id);
    const afterCount = await prisma.inventoryMovement.count({
      where: { listingId },
    });
    assert.strictEqual(afterCount, beforeCount);
  });
});
