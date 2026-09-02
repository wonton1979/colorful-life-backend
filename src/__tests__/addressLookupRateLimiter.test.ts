import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { consumeAddressLookupAllowance, resetAddressLookupRateLimiterForTests, setAddressLookupRateLimiterClockForTests } from "../services/addressLookupRateLimiter.js";

afterEach(() => resetAddressLookupRateLimiterForTests());

describe("address lookup rate limiter", () => {
  it("allows three calls and blocks the fourth", () => {
    for (let i = 0; i < 3; i += 1) assert.equal(consumeAddressLookupAllowance(1), true);
    assert.equal(consumeAddressLookupAllowance(1), false);
  });
  it("keeps users independent and resets after fifteen minutes", () => {
    let now = 1_000;
    const restore = setAddressLookupRateLimiterClockForTests(() => now);
    for (let i = 0; i < 3; i += 1) consumeAddressLookupAllowance(1);
    assert.equal(consumeAddressLookupAllowance(1), false);
    assert.equal(consumeAddressLookupAllowance(2), true);
    now += 15 * 60 * 1000;
    assert.equal(consumeAddressLookupAllowance(1), true);
    restore();
  });
});
