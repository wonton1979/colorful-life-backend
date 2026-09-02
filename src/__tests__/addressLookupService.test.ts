import { strict as assert } from "node:assert";
import { afterEach, before, describe, it } from "node:test";

process.env.IDEAL_POSTCODES_API_KEY = "test-provider-key";

const service = await import("../services/addressLookupService.js");
const { lookupUkAddresses, setAddressLookupFetcherForTests, AddressLookupProviderError } = service;
const restores: Array<() => void> = [];

afterEach(() => { while (restores.length) restores.pop()!(); });

function response(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

describe("address lookup service", () => {
  it("constructs the provider request and normalizes results", async () => {
    let request = "";
    restores.push(setAddressLookupFetcherForTests(async (input) => {
      request = input;
      return response({ code: 2000, result: [
        { line_1: " 10 Main  Street ", line_2: "Flat 2", line_3: "Rear Building", post_town: " Sheffield ", county: "South Yorkshire", postcode: "S1 1AA" },
        { line_1: "20 High Road", line_3: "Annex", post_town: "Sheffield", postcode: "S1 1AA" },
      ] });
    }));
    const addresses = await lookupUkAddresses("S1 1AA");
    const parsed = new URL(request);
    assert.equal(parsed.pathname, "/v1/postcodes/S1%201AA");
    assert.equal(parsed.searchParams.get("api_key"), "test-provider-key");
    assert.deepEqual(addresses, [
      { line1: "10 Main Street", line2: "Flat 2, Rear Building", city: "Sheffield", county: "South Yorkshire", postcode: "S1 1AA", country: "United Kingdom" },
      { line1: "20 High Road", line2: "Annex", city: "Sheffield", county: null, postcode: "S1 1AA", country: "United Kingdom" },
    ]);
  });

  it("returns an empty list for no provider results and null for missing secondary lines", async () => {
    restores.push(setAddressLookupFetcherForTests(async () => response({ code: 2000, result: [] })));
    assert.deepEqual(await lookupUkAddresses("S1 1AA"), []);
    restores.push(setAddressLookupFetcherForTests(async () => response({ code: 2000, result: [
      { line_1: "1 Main Road", post_town: "Sheffield", county: null, postcode: "S1 1AA" },
    ] })));
    assert.equal((await lookupUkAddresses("S1 1AA"))[0].line2, null);
  });

  it("converts provider and network failures to a generic service error", async () => {
    for (const fetchFailure of [
      async () => response({}, false),
      async () => { throw new Error("secret key or provider URL"); },
    ]) {
      restores.push(setAddressLookupFetcherForTests(fetchFailure));
      await assert.rejects(() => lookupUkAddresses("S1 1AA"), (error: unknown) =>
        error instanceof AddressLookupProviderError && !error.message.includes("secret"));
    }
  });
});
