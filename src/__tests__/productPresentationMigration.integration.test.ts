import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma-client/client.js";
import { createProductFeatureService, FeatureProductCategoryChangedError } from "../domain/products/productFeatureService.js";
import { config } from "../config/index.js";
import { TEST_DATABASE_NAME, validateTestDatabase } from "../config/testDatabase.js";

const migration = readFileSync(resolve(process.cwd(), "prisma/migrations/20260925140000_move_product_presentation_to_lego_product/migration.sql"), "utf8");
const pool = new Pool({ connectionString: config.DATABASE_URL, max: 3 });
let verifiedTestDatabase = false;

before(async () => {
  assert.equal(config.DATABASE_URL, validateTestDatabase(process.env).url);
  const client = await pool.connect();
  try {
    const result = await client.query<{ name: string }>("SELECT current_database() AS name");
    assert.equal(result.rows[0]?.name, TEST_DATABASE_NAME);
    verifiedTestDatabase = true;
  } finally {
    client.release();
  }
});

after(async () => { await pool.end(); });

async function withLegacySchema<T>(run: (client: PoolClient, schema: string) => Promise<T>) {
  assert.equal(verifiedTestDatabase, true, "temporary migration schemas are allowed only in colorful_life_test");
  const client = await pool.connect();
  const schema = `product_presentation_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  try {
    await client.query(`CREATE SCHEMA ${quotedSchema}`);
    await client.query(`SET search_path TO ${quotedSchema}`);
    await client.query("SET statement_timeout = '5s'");
    await client.query(`
      CREATE TABLE "LegoProduct" ("id" INTEGER PRIMARY KEY, "categoryId" INTEGER, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE "ProductListing" (
        "id" INTEGER PRIMARY KEY,
        "legoProductId" INTEGER NOT NULL REFERENCES "LegoProduct"("id"),
        "catalogueArtworkUrl" TEXT,
        "catalogueArtworkPublicId" TEXT,
        "isFeatureProduct" BOOLEAN NOT NULL DEFAULT false,
        "condition" TEXT NOT NULL DEFAULT 'NEW',
        "currentStock" INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE "ListingImage" (
        "id" SERIAL NOT NULL,
        "listingId" INTEGER NOT NULL REFERENCES "ProductListing"("id") ON DELETE CASCADE,
        "url" TEXT NOT NULL,
        "publicId" TEXT NOT NULL,
        "altText" TEXT,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ListingImage_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX "ListingImage_listingId_idx" ON "ListingImage"("listingId");
      CREATE INDEX "ListingImage_listingId_sortOrder_idx" ON "ListingImage"("listingId", "sortOrder");
    `);
    return await run(client, schema);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.query("SET search_path TO public").catch(() => {});
    await client.query("RESET statement_timeout").catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`).catch(() => {});
    client.release();
  }
}

async function withConcurrentClient<T>(schema: string, run: (client: PoolClient) => Promise<T>) {
  assert.equal(verifiedTestDatabase, true);
  const client = await pool.connect();
  try {
    assert.equal((await client.query("SELECT current_database() AS name")).rows[0].name, TEST_DATABASE_NAME);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query("SET statement_timeout = '5s'");
    return await run(client);
  } finally {
    await client.query("ROLLBACK");
    await client.query("RESET search_path; RESET statement_timeout; RESET lock_timeout");
    client.release();
  }
}

async function waitForAdvisoryWaiter(client: PoolClient, pid: number) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const waiting = await client.query(`
      SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted AND pid = $1
    `, [pid]);
    if (waiting.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Feature selection did not reach its category advisory lock");
}

async function insertProduct(client: PoolClient, id: number, categoryId: number | null) {
  await client.query('INSERT INTO "LegoProduct" ("id", "categoryId") VALUES ($1, $2)', [id, categoryId]);
}

async function insertListing(client: PoolClient, input: {
  id: number; productId: number; condition?: "NEW" | "USED_LIKE_NEW"; currentStock?: number;
  artworkUrl?: string | null; artworkPublicId?: string | null; feature?: boolean;
}) {
  await client.query(
    'INSERT INTO "ProductListing" ("id", "legoProductId", "condition", "currentStock", "catalogueArtworkUrl", "catalogueArtworkPublicId", "isFeatureProduct") VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [input.id, input.productId, input.condition ?? "NEW", input.currentStock ?? 0, input.artworkUrl ?? null, input.artworkPublicId ?? null, input.feature ?? false],
  );
}

async function insertImage(client: PoolClient, input: { id: number; listingId: number; publicId: string; sortOrder: number; altText?: string | null }) {
  await client.query(
    'INSERT INTO "ListingImage" ("id", "listingId", "url", "publicId", "altText", "sortOrder") VALUES ($1, $2, $3, $4, $5, $6)',
    [input.id, input.listingId, `https://images.test/${input.id}`, input.publicId, input.altText ?? null, input.sortOrder],
  );
}

describe("LegoProduct presentation ownership migration", () => {
  it("locks every legacy source before preflight and holds locks across backfill/contraction", async () => {
    await withLegacySchema(async (client, schema) => {
      await insertProduct(client, 1, 10);
      await insertListing(client, { id: 100, productId: 1, artworkUrl: "original", artworkPublicId: "original-id" });
      await insertListing(client, { id: 101, productId: 1, condition: "USED_LIKE_NEW" });
      await insertImage(client, { id: 11, listingId: 100, publicId: "original-image", sortOrder: 0 });
      const preflight = migration.indexOf("DO $$");
      const images = migration.indexOf("-- Preserve ProductImage row IDs");
      assert.ok(preflight > 0 && images > preflight);
      await client.query(migration.slice(0, preflight));
      await withConcurrentClient(schema, async (writer) => {
        await writer.query("SET lock_timeout = '100ms'");
        const locks = await client.query(`
          SELECT c.relname FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
          WHERE l.pid = pg_backend_pid() AND l.granted AND l.mode = 'AccessExclusiveLock'
          ORDER BY c.relname
        `);
        assert.deepEqual(locks.rows.map((row) => row.relname), ["LegoProduct", "ListingImage", "ProductListing"]);
        await assert.rejects(writer.query('UPDATE "LegoProduct" SET "categoryId" = 20 WHERE "id" = 1'), (error: any) => error.code === "55P03");
        await assert.rejects(writer.query('UPDATE "ProductListing" SET "catalogueArtworkUrl" = \'late\' WHERE "id" = 100'), (error: any) => error.code === "55P03");
        await client.query(migration.slice(preflight, images));
        // This is the exact gap in the old migration: artwork is already
        // backfilled, but ListingImage and legacy artwork were still writable.
        await assert.rejects(writer.query('UPDATE "ProductListing" SET "catalogueArtworkUrl" = \'lost-update\' WHERE "id" = 100'), (error: any) => error.code === "55P03");
        await assert.rejects(insertImage(writer, { id: 12, listingId: 101, publicId: "late-sibling-image", sortOrder: 0 }), (error: any) => error.code === "55P03");
        await client.query(migration.slice(images));
        assert.equal((await writer.query('SELECT "catalogueArtworkUrl" FROM "LegoProduct" WHERE "id" = 1')).rows[0].catalogueArtworkUrl, "original");
        assert.deepEqual((await writer.query('SELECT "id", "publicId" FROM "ProductImage"')).rows, [{ id: 11, publicId: "original-image" }]);
      });
    });
  });

  it("fails fast behind an existing writer; retry preserves committed artwork or rejects committed sibling images", async () => {
    for (const scenario of ["artwork", "sibling-image"] as const) {
      await withLegacySchema(async (client, schema) => {
        await insertProduct(client, 1, 10);
        await insertListing(client, { id: 100, productId: 1, artworkUrl: "old", artworkPublicId: "old-id" });
        await insertListing(client, { id: 101, productId: 1, condition: "USED_LIKE_NEW" });
        await insertImage(client, { id: 11, listingId: 100, publicId: "old-image", sortOrder: 0 });
        await withConcurrentClient(schema, async (writer) => {
          await writer.query("BEGIN");
          if (scenario === "artwork") {
            await writer.query('UPDATE "ProductListing" SET "catalogueArtworkUrl" = \'committed-art\', "catalogueArtworkPublicId" = \'committed-id\' WHERE "id" = 100');
          } else {
            await insertImage(writer, { id: 12, listingId: 101, publicId: "committed-sibling-image", sortOrder: 0 });
          }
          await assert.rejects(client.query(migration), (error: any) => error.code === "55P03");
          await client.query("ROLLBACK");
          await writer.query("COMMIT");
        });
        if (scenario === "artwork") {
          await client.query(migration);
          assert.deepEqual((await client.query('SELECT "catalogueArtworkUrl", "catalogueArtworkPublicId" FROM "LegoProduct"')).rows,
            [{ catalogueArtworkUrl: "committed-art", catalogueArtworkPublicId: "committed-id" }]);
        } else {
          await assert.rejects(client.query(migration), (error: any) => error.message.includes("multiple sibling listings") && error.message.includes("1"));
          await client.query("ROLLBACK");
          assert.deepEqual((await client.query('SELECT "id", "listingId" FROM "ListingImage" ORDER BY "id"')).rows,
            [{ id: 11, listingId: 100 }, { id: 12, listingId: 101 }]);
          assert.equal((await client.query('SELECT "catalogueArtworkUrl" FROM "ProductListing" WHERE "id" = 100')).rows[0].catalogueArtworkUrl, "old");
        }
      });
    }
  });

  it("rejects uncategorized legacy Feature state with product IDs and leaves the legacy schema/data intact", async () => {
    await withLegacySchema(async (client) => {
      await insertProduct(client, 701, null);
      await insertListing(client, { id: 7010, productId: 701, feature: true, artworkUrl: "preserve-me" });
      await insertImage(client, { id: 7011, listingId: 7010, publicId: "preserve-image", sortOrder: 4, altText: "Preserve alt" });
      await assert.rejects(client.query(migration), (error: any) => error.message.includes("featured LegoProduct IDs 701 have no Category"));
      await client.query("ROLLBACK");
      assert.deepEqual((await client.query('SELECT "catalogueArtworkUrl", "isFeatureProduct" FROM "ProductListing"')).rows,
        [{ catalogueArtworkUrl: "preserve-me", isFeatureProduct: true }]);
      assert.deepEqual((await client.query('SELECT "id", "listingId", "publicId", "sortOrder", "altText" FROM "ListingImage"')).rows,
        [{ id: 7011, listingId: 7010, publicId: "preserve-image", sortOrder: 4, altText: "Preserve alt" }]);
      assert.equal((await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'LegoProduct' AND column_name = 'isFeatureProduct'")).rowCount, 0);
    });
  });

  it("allows unfeatured uncategorized products and enforces Feature/category constraints on direct inserts and updates", async () => {
    await withLegacySchema(async (client) => {
      await insertProduct(client, 1, null);
      await insertListing(client, { id: 100, productId: 1 });
      await insertProduct(client, 2, 10);
      await insertListing(client, { id: 200, productId: 2, feature: true });
      await insertProduct(client, 3, 20);
      await insertListing(client, { id: 300, productId: 3, feature: true });
      await client.query(migration);
      assert.deepEqual((await client.query('SELECT "categoryId", "isFeatureProduct" FROM "LegoProduct" WHERE "id" = 1')).rows, [{ categoryId: null, isFeatureProduct: false }]);
      for (const sql of [
        'UPDATE "LegoProduct" SET "isFeatureProduct" = true WHERE "id" = 1',
        'UPDATE "LegoProduct" SET "categoryId" = NULL WHERE "id" = 2',
        'INSERT INTO "LegoProduct" ("id", "isFeatureProduct") VALUES (4, true)',
      ]) {
        await assert.rejects(client.query(sql), (error: any) => error.code === "23514" && error.constraint === "LegoProduct_feature_requires_category_check");
      }
      await assert.rejects(client.query('UPDATE "LegoProduct" SET "categoryId" = 20 WHERE "id" = 2'), (error: any) => error.code === "23505");
      await client.query('UPDATE "LegoProduct" SET "categoryId" = 30 WHERE "id" = 2');
      await client.query('UPDATE "LegoProduct" SET "categoryId" = NULL, "isFeatureProduct" = false WHERE "id" = 2');
      assert.deepEqual((await client.query('SELECT "categoryId", "isFeatureProduct" FROM "LegoProduct" WHERE "id" = 2')).rows, [{ categoryId: null, isFeatureProduct: false }]);
    });
  });

  it("does not deadlock category selection against a direct category update holding the product row", async () => {
    await withLegacySchema(async (selection, schema) => {
      await insertProduct(selection, 1, 10);
      await insertListing(selection, { id: 100, productId: 1, feature: true });
      await selection.query(migration);
      await withConcurrentClient(schema, async (move) => {
        await selection.query("BEGIN; SELECT pg_advisory_xact_lock(10)");
        await move.query('BEGIN; SELECT "id" FROM "LegoProduct" WHERE "id" = 1 FOR UPDATE');
        // Reproduce advisory -> row versus row -> category UPDATE. With the
        // former trigger these statements form a real PostgreSQL deadlock.
        const moved = move.query('UPDATE "LegoProduct" SET "categoryId" = 20 WHERE "id" = 1').then(() => null, (error: Error) => error);
        const selected = selection.query('SELECT "id" FROM "LegoProduct" WHERE "categoryId" = 10 ORDER BY "id" FOR UPDATE').then((result) => result.rows, (error: Error) => error);
        try {
          assert.equal(await moved, null);
          await move.query("COMMIT");
          assert.deepEqual(await selected, [], "moved candidate must not be selected under the old category lock");
          await selection.query("COMMIT");
          assert.deepEqual((await selection.query('SELECT "categoryId", "isFeatureProduct" FROM "LegoProduct" WHERE "id" = 1')).rows,
            [{ categoryId: 20, isFeatureProduct: true }]);
        } finally {
          await move.query("ROLLBACK");
          await selection.query("ROLLBACK");
          await Promise.all([moved, selected]);
        }
      });
    });
  });

  it("revalidates the actual Feature service candidate after waiting, without changing either category's Feature", async () => {
    await withLegacySchema(async (client, schema) => {
      await insertProduct(client, 1, 10);
      await insertListing(client, { id: 100, productId: 1 });
      await insertProduct(client, 2, 10);
      await insertListing(client, { id: 200, productId: 2, feature: true });
      await insertProduct(client, 3, 20);
      await insertListing(client, { id: 300, productId: 3, feature: true });
      await client.query(migration);
      const db = new PrismaClient({ adapter: new PrismaPg({
        connectionString: config.DATABASE_URL, options: `-c search_path=${schema}`, max: 1,
      }, { schema }) });
      let pending: Promise<unknown> | undefined;
      try {
        const [connection] = await db.$queryRaw<Array<{ pid: number; database: string; schema: string }>>`SELECT pg_backend_pid() AS pid, current_database() AS database, current_schema() AS schema`;
        assert.equal(connection.database, TEST_DATABASE_NAME);
        assert.equal(connection.schema, schema);
        await client.query("BEGIN; SELECT pg_advisory_xact_lock(10)");
        pending = createProductFeatureService(db).setFeature(1).catch((error: unknown) => error);
        await Promise.race([
          waitForAdvisoryWaiter(client, connection.pid),
          pending.then((result) => assert.fail(`Feature selection finished before waiting: ${String(result)}`)),
        ]);
        await withConcurrentClient(schema, (move) => move.query('UPDATE "LegoProduct" SET "categoryId" = 20 WHERE "id" = 1'));
        await client.query("COMMIT");
        assert.ok(await pending instanceof FeatureProductCategoryChangedError);
        assert.deepEqual((await client.query('SELECT "id" FROM "LegoProduct" WHERE "isFeatureProduct" ORDER BY "id"')).rows, [{ id: 2 }, { id: 3 }]);
        // A new request uses the new category lock and performs normal manual selection.
        assert.deepEqual(await createProductFeatureService(db).setFeature(1), { id: 1, isFeatureProduct: true });
        assert.deepEqual((await client.query('SELECT "id" FROM "LegoProduct" WHERE "isFeatureProduct" ORDER BY "id"')).rows, [{ id: 1 }, { id: 2 }]);
      } finally {
        await client.query("ROLLBACK");
        await pending;
        await db.$disconnect();
      }
    });
  });

  it("moves unambiguous presentation once, preserving image IDs, order, alt text, zero-stock NEW and incomplete artwork metadata", async () => {
    await withLegacySchema(async (client) => {
      await insertProduct(client, 1, 10);
      await insertListing(client, { id: 100, productId: 1, condition: "NEW", currentStock: 0, artworkUrl: "https://images.test/artwork", artworkPublicId: "artwork-100", feature: true });
      await insertListing(client, { id: 101, productId: 1, condition: "USED_LIKE_NEW", currentStock: 1 });
      await insertImage(client, { id: 11, listingId: 100, publicId: "image-11", sortOrder: 3, altText: "Box back" });
      await insertImage(client, { id: 12, listingId: 100, publicId: "image-12", sortOrder: 1, altText: "Front view" });

      await insertProduct(client, 2, 10);
      await insertListing(client, { id: 200, productId: 2, condition: "NEW", currentStock: 4 });
      await insertProduct(client, 3, 20);
      await insertListing(client, { id: 300, productId: 3, artworkUrl: "https://images.test/incomplete-artwork" });
      await insertProduct(client, 4, 30);
      await insertListing(client, { id: 400, productId: 4, artworkUrl: "https://images.test/single-listing-art", artworkPublicId: "single-art" });
      await insertImage(client, { id: 41, listingId: 400, publicId: "single-product-image", sortOrder: 0, altText: "Only listing" });

      await client.query(migration);
      const products = await client.query<{ id: number; catalogueArtworkUrl: string | null; catalogueArtworkPublicId: string | null; isFeatureProduct: boolean }>(
        'SELECT "id", "catalogueArtworkUrl", "catalogueArtworkPublicId", "isFeatureProduct" FROM "LegoProduct" ORDER BY "id"',
      );
      assert.deepEqual(products.rows, [
        { id: 1, catalogueArtworkUrl: "https://images.test/artwork", catalogueArtworkPublicId: "artwork-100", isFeatureProduct: true },
        { id: 2, catalogueArtworkUrl: null, catalogueArtworkPublicId: null, isFeatureProduct: false },
        { id: 3, catalogueArtworkUrl: "https://images.test/incomplete-artwork", catalogueArtworkPublicId: null, isFeatureProduct: false },
        { id: 4, catalogueArtworkUrl: "https://images.test/single-listing-art", catalogueArtworkPublicId: "single-art", isFeatureProduct: false },
      ]);
      const images = await client.query<{ id: number; legoProductId: number; altText: string | null; sortOrder: number }>(
        'SELECT "id", "legoProductId", "altText", "sortOrder" FROM "ProductImage" ORDER BY "sortOrder", "id"',
      );
      assert.deepEqual(images.rows, [
        { id: 41, legoProductId: 4, altText: "Only listing", sortOrder: 0 },
        { id: 12, legoProductId: 1, altText: "Front view", sortOrder: 1 },
        { id: 11, legoProductId: 1, altText: "Box back", sortOrder: 3 },
      ]);
      const newImage = await client.query('INSERT INTO "ProductImage" ("legoProductId", "url", "publicId") VALUES (4, $1, $2) RETURNING "id"', ["https://images.test/new", "new-after-migration"]);
      assert.ok(newImage.rows[0].id > 41, "renamed sequence continues generating unique ProductImage IDs");
      const zeroStock = await client.query<{ currentStock: number; condition: string }>('SELECT "currentStock", "condition" FROM "ProductListing" WHERE "id" = 100');
      assert.deepEqual(zeroStock.rows[0], { currentStock: 0, condition: "NEW" });
      await assert.rejects(
        client.query('UPDATE "LegoProduct" SET "isFeatureProduct" = true WHERE "id" = 2'),
        (error: any) => error.code === "23505",
      );
    });
  });

  it("aborts transactionally and names product IDs for sibling artwork conflicts, independent of stock", async () => {
    await withLegacySchema(async (client) => {
      await insertProduct(client, 71, 4);
      await insertListing(client, { id: 710, productId: 71, condition: "NEW", currentStock: 0, artworkUrl: "https://images.test/new", artworkPublicId: "new-art" });
      await insertListing(client, { id: 711, productId: 71, condition: "USED_LIKE_NEW", currentStock: 1, artworkUrl: "https://images.test/used", artworkPublicId: "used-art" });
      await assert.rejects(client.query(migration), (error: any) => error.message.includes("conflicting catalogue artwork") && error.message.includes("71"));
      await client.query("ROLLBACK");
      const legacy = await client.query('SELECT "catalogueArtworkUrl" FROM "ProductListing" ORDER BY "id"');
      assert.equal(legacy.rows[0].catalogueArtworkUrl, "https://images.test/new");
      const newColumn = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'LegoProduct' AND column_name = 'isFeatureProduct'");
      assert.equal(newColumn.rowCount, 0, "failed migration leaves the old schema intact");
    });
  });

  it("aborts rather than merging sibling image sets with different owners", async () => {
    await withLegacySchema(async (client) => {
      await insertProduct(client, 81, 5);
      await insertListing(client, { id: 810, productId: 81 });
      await insertListing(client, { id: 811, productId: 81, condition: "USED_LIKE_NEW" });
      await insertImage(client, { id: 81, listingId: 810, publicId: "new-image", sortOrder: 0 });
      await insertImage(client, { id: 82, listingId: 811, publicId: "used-image", sortOrder: 0 });
      await assert.rejects(client.query(migration), (error: any) => error.message.includes("multiple sibling listings") && error.message.includes("81"));
    });
  });

  it("rejects duplicate asset IDs, duplicate image order, and conflicting features explicitly", async () => {
    for (const scenario of ["duplicate-public-id", "duplicate-artwork-public-id", "duplicate-sort-order", "feature-conflict"] as const) {
      await withLegacySchema(async (client) => {
        if (scenario === "feature-conflict") {
          await insertProduct(client, 91, 9); await insertListing(client, { id: 910, productId: 91, feature: true });
          await insertProduct(client, 92, 9); await insertListing(client, { id: 920, productId: 92, feature: true });
        } else if (scenario === "duplicate-artwork-public-id") {
          await insertProduct(client, 91, 9); await insertListing(client, { id: 910, productId: 91, artworkUrl: "https://images.test/art-a", artworkPublicId: "shared-art" });
          await insertProduct(client, 92, 10); await insertListing(client, { id: 920, productId: 92, artworkUrl: "https://images.test/art-b", artworkPublicId: "shared-art" });
        } else {
          await insertProduct(client, 91, 9); await insertListing(client, { id: 910, productId: 91 });
          const duplicate = scenario === "duplicate-public-id";
          await insertImage(client, { id: 911, listingId: 910, publicId: "same-or-first", sortOrder: 0 });
          await insertImage(client, { id: 912, listingId: 910, publicId: duplicate ? "same-or-first" : "second", sortOrder: duplicate ? 1 : 0 });
        }
        const expected = scenario === "duplicate-artwork-public-id" ? "catalogue artwork public IDs are shared"
          : scenario === "duplicate-public-id" ? "duplicate Product Image public IDs"
            : scenario === "duplicate-sort-order" ? "duplicate Product Image sort orders" : "conflicting featured products";
        await assert.rejects(client.query(migration), (error: any) => error.message.includes(expected) && error.message.includes(scenario === "feature-conflict" ? "9" : "91"));
      });
    }
  });

  it("rejects complementary incomplete sibling artwork tuples instead of combining them", async () => {
    await withLegacySchema(async (client) => {
      await insertProduct(client, 101, 6);
      await insertListing(client, { id: 1010, productId: 101, artworkUrl: "https://images.test/partial" });
      await insertListing(client, { id: 1011, productId: 101, artworkPublicId: "partial-public-id" });
      await assert.rejects(client.query(migration), (error: any) => error.message.includes("conflicting catalogue artwork") && error.message.includes("101"));
    });
  });
});
