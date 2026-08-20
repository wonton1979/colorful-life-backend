import { strict as assert } from "node:assert";
import { describe, it, afterEach } from "node:test";
import { randomUUID } from "node:crypto";

import { prisma } from "../prisma/runtime.js";
import { matchProductListingId } from "../services/purchaseItemMatcher.js";

/**
 * Keeps track of product IDs created by individual tests so they can be
 * cleaned up precisely without affecting other records.
 */
let trackedProductIds: number[] = [];

async function cleanupTrackedProducts(): Promise<void> {
  if (trackedProductIds.length) {
    await prisma.productListing.deleteMany({
      where: { legoProductId: { in: trackedProductIds } },
    });
    await prisma.legoProduct.deleteMany({ where: { id: { in: trackedProductIds } } });
  }
  // Reset for the next test.
  trackedProductIds = [];
}

describe("matchProductListingId", () => {
  afterEach(async () => {
    await cleanupTrackedProducts();
  });

  it("returns null when sourceSetNumber is missing", async () => {
    const id = await matchProductListingId(null);
    assert.strictEqual(id, null);
  });

  it("returns null for an unknown set number", async () => {
    const unknownSet = randomUUID();
    const id = await matchProductListingId(unknownSet);
    assert.strictEqual(id, null);
  });

  it("returns null when the LegoProduct has no ProductListing", async () => {
    // Create a product with no listings
    const product = await prisma.legoProduct.create({
      data: {
        setNumber: randomUUID(),
        title: "Test Product 1",
        description: "desc",
        theme: "Test",
        ageRecommendation: "8+",
        pieceCount: 100,
      },
    });
    trackedProductIds.push(product.id);
    const id = await matchProductListingId(product.setNumber);
    assert.strictEqual(id, null);
  });

  it("returns the listing ID when there is exactly one ProductListing", async () => {
    const product = await prisma.legoProduct.create({
      data: {
        setNumber: randomUUID(),
        title: "Test Product 2",
        description: "desc",
        theme: "Test",
        ageRecommendation: "8+",
        pieceCount: 200,
      },
    });
    const listing = await prisma.productListing.create({
      data: {
        legoProductId: product.id,
        condition: "NEW",
        originalPrice: 10.0,
        currentStock: 5,
      },
    });
    trackedProductIds.push(product.id);
    const id = await matchProductListingId(product.setNumber);
    assert.strictEqual(id, listing.id);
  });

  it("returns null when the LegoProduct has multiple ProductListings", async () => {
    const product = await prisma.legoProduct.create({
      data: {
        setNumber: randomUUID(),
        title: "Test Product 3",
        description: "desc",
        theme: "Test",
        ageRecommendation: "8+",
        pieceCount: 300,
      },
    });
    await prisma.productListing.createMany({
      data: [
        {
          legoProductId: product.id,
          condition: "NEW",
          originalPrice: 15.0,
          currentStock: 5,
        },
        {
          legoProductId: product.id,
          condition: "USED_LIKE_NEW",
          originalPrice: 12.0,
          currentStock: 3,
        },
      ],
    });
    trackedProductIds.push(product.id);
    const id = await matchProductListingId(product.setNumber);
    assert.strictEqual(id, null);
  });
});
