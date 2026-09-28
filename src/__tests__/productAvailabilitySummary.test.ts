import assert from "node:assert/strict";
import { it } from "node:test";
import type { PrismaClient } from "../generated/prisma-client/client.js";
import { createProductAvailabilitySummaryService } from "../domain/products/productAvailabilitySummary.js";

it("returns zero counts when the global catalogue query has no products", async () => {
  const db = {
    $queryRaw: async () => [{ totalProducts: 0n, activeProducts: 0n }],
  } as unknown as PrismaClient;

  assert.deepEqual(await createProductAvailabilitySummaryService(db).global(), {
    totalProducts: 0,
    activeProducts: 0,
    inactiveProducts: 0,
  });
});
