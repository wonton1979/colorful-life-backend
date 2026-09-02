import assert from "node:assert";
import type { Server } from "node:http";
import { after, afterEach, before, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

// Set the non-production test key before loading app/config and its service graph.
process.env.IDEAL_POSTCODES_API_KEY = "test-provider-key";
const { default: app } = await import("../app.js");
const { setAddressLookupFetcherForTests } = await import("../services/addressLookupService.js");
const { resetAddressLookupRateLimiterForTests } = await import("../services/addressLookupRateLimiter.js");
const { config } = await import("../config/index.js");
const { prisma } = await import("../prisma/runtime.js");

describe("Address lookup HTTP", () => {
  let server: Server;
  let url: string;
  let restore: (() => void) | undefined;
  let calls = 0;
  const userIds: number[] = [];

  before(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as { port: number };
    url = `http://localhost:${address.port}`;
  });

  after(async () => {
    restore?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(async () => {
    resetAddressLookupRateLimiterForTests();
    restore?.();
    restore = undefined;
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    }
  });

  async function customer() {
    const user = await prisma.user.create({
      data: {
        email: `lookup-${randomUUID()}@example.com`,
        passwordHash: "test-password-hash",
        role: "CUSTOMER",
        emailVerified: true,
      },
    });
    userIds.push(user.id);
    return jwt.sign({ id: user.id, role: user.role }, config.JWT_SECRET, { expiresIn: "1h" });
  }

  function installProvider(result: unknown, ok = true) {
    calls = 0;
    restore = setAddressLookupFetcherForTests(async () => { calls += 1; return { ok, json: async () => result } as Response; });
  }

  async function lookup(token: string, postcode = "S70 2XX") {
    return fetch(`${url}/users/me/addresses/lookup?postcode=${encodeURIComponent(postcode)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  it("requires authentication before provider invocation", async () => {
    installProvider({ code: 2000, result: [] });
    const result = await fetch(`${url}/users/me/addresses/lookup?postcode=S70%202XX`);
    assert.equal(result.status, 401);
    assert.equal(calls, 0);
  });

  it("validates, normalizes, and returns provider addresses", async () => {
    installProvider({ code: 2000, result: [{ line_1: "1 Main Road", line_2: "Flat 1", line_3: "Rear", post_town: "Sheffield", county: "South Yorkshire", postcode: "S70 2XX" }] });
    const token = await customer();
    const result = await fetch(`${url}/users/me/addresses/lookup?postcode=%20s70%202xx%20`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { addresses: [{ line1: "1 Main Road", line2: "Flat 1, Rear", city: "Sheffield", county: "South Yorkshire", postcode: "S70 2XX", country: "United Kingdom" }] });
    assert.equal(calls, 1);
  });

  it("rejects missing, empty, and malformed postcodes without calling provider", async () => {
    installProvider({ code: 2000, result: [] });
    const token = await customer();
    for (const query of ["", "%20%20", "not-a-postcode"]) {
      const result = await fetch(`${url}/users/me/addresses/lookup?postcode=${query}`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(result.status, 400);
    }
    assert.equal(calls, 0);
  });

  it("returns zero results and maps provider failures generically", async () => {
    installProvider({ code: 2000, result: [] });
    const token = await customer();
    const empty = await fetch(`${url}/users/me/addresses/lookup?postcode=S70%202XX`, { headers: { Authorization: `Bearer ${token}` } });
    assert.deepEqual(await empty.json(), { addresses: [] });
    restore?.();
    installProvider({ secret: "provider detail" }, false);
    const failed = await fetch(`${url}/users/me/addresses/lookup?postcode=S70%202XX`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: "Address lookup service unavailable" });
  });

  it("allows three valid requests and blocks the fourth without invoking the provider", async () => {
    installProvider({ code: 2000, result: [] });
    const token = await customer();
    for (let i = 0; i < 3; i += 1) assert.equal((await lookup(token)).status, 200);
    assert.equal((await lookup(token)).status, 429);
    assert.equal(calls, 3);
  });

  it("does not consume quota for invalid postcodes", async () => {
    installProvider({ code: 2000, result: [] });
    const token = await customer();
    for (const postcode of ["", "not-a-postcode", "   "]) assert.equal((await lookup(token, postcode)).status, 400);
    for (let i = 0; i < 3; i += 1) assert.equal((await lookup(token)).status, 200);
    assert.equal(calls, 3);
  });

  it("counts provider zero results against the quota", async () => {
    installProvider({ code: 2000, result: [] });
    const token = await customer();
    for (let i = 0; i < 3; i += 1) assert.deepEqual(await (await lookup(token)).json(), { addresses: [] });
    assert.equal((await lookup(token)).status, 429);
    assert.equal(calls, 3);
  });

  it("counts provider failures against the quota", async () => {
    installProvider({ provider: "failure" }, false);
    const token = await customer();
    for (let i = 0; i < 3; i += 1) assert.equal((await lookup(token)).status, 503);
    assert.equal((await lookup(token)).status, 429);
    assert.equal(calls, 3);
  });
});
