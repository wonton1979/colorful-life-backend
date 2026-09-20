import assert from "node:assert/strict";
import { after, it } from "node:test";
import { config } from "../config/index.js";
import { validateTestDatabase } from "../config/testDatabase.js";
import { prisma } from "../prisma/runtime.js";

after(async () => { await prisma.$disconnect(); });

it("the shared Prisma client actually connects to the dedicated test database", async () => {
  const target = validateTestDatabase(process.env);
  assert.equal(config.DATABASE_URL, target.url);
  assert.notEqual(config.DATABASE_URL, process.env.DATABASE_URL);
  const [connection] = await prisma.$queryRaw<Array<{ database: string; schema: string }>>`
    SELECT current_database() AS database, current_schema() AS schema
  `;
  assert.deepEqual(connection, { database: "colorful_life_test", schema: "public" });
});
