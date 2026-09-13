import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CartItemSchema, UpdateCartItemSchema } from "../domain/cart/cartValidator.js";

describe("cart validation", () => {
  it("accepts positive integer listing quantities", () => {
    assert.deepEqual(CartItemSchema.parse({ productListingId: 4, quantity: 2 }), { productListingId: 4, quantity: 2 });
    assert.deepEqual(UpdateCartItemSchema.parse({ quantity: 1 }), { quantity: 1 });
  });

  it("rejects missing, zero, negative, fractional, and non-numeric quantities", () => {
    for (const value of [undefined, 0, -1, 1.5, "2"]) {
      assert.equal(CartItemSchema.safeParse({ productListingId: 4, quantity: value }).success, false);
      assert.equal(UpdateCartItemSchema.safeParse({ quantity: value }).success, false);
    }
  });
});
