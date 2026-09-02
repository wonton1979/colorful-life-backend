import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { requireVerifiedEmail, setVerifiedEmailUserLookupForTests } from "../middleware/requireVerifiedEmail.js";

const restores: Array<() => void> = [];
afterEach(() => { while (restores.length) restores.pop()!(); });

function response() {
  let statusCode = 200;
  let body: unknown;
  const res = {
    status(code: number) { statusCode = code; return res; },
    json(value: unknown) { body = value; return res; },
  } as unknown as Response;
  return { res, get statusCode() { return statusCode; }, get body() { return body; } };
}

function request(id?: number, role = "CUSTOMER") {
  return { user: id === undefined ? undefined : { id, role } } as unknown as Request;
}

describe("requireVerifiedEmail", () => {
  it("rejects an unverified customer and does not call next", async () => {
    restores.push(setVerifiedEmailUserLookupForTests(async () => ({ emailVerified: false })));
    const output = response(); let reached = false;
    await requireVerifiedEmail(request(1), output.res, (() => { reached = true; }) as NextFunction);
    assert.equal(output.statusCode, 403);
    assert.deepEqual(output.body, { error: "Email verification required" });
    assert.equal(reached, false);
  });

  it("uses current database state for the same authenticated identity", async () => {
    let verified = false;
    restores.push(setVerifiedEmailUserLookupForTests(async () => ({ emailVerified: verified })));
    let reached = 0;
    const next = (() => { reached += 1; }) as NextFunction;
    const first = response();
    await requireVerifiedEmail(request(7), first.res, next);
    verified = true;
    const second = response();
    await requireVerifiedEmail(request(7), second.res, next);
    assert.equal(first.statusCode, 403);
    assert.equal(second.statusCode, 200);
    assert.equal(reached, 1);
  });

  it("passes verified customers", async () => {
    restores.push(setVerifiedEmailUserLookupForTests(async () => ({ emailVerified: true })));
    let reached = false;
    await requireVerifiedEmail(request(2), response().res, (() => { reached = true; }) as NextFunction);
    assert.equal(reached, true);
  });

  it("rejects missing users and missing authentication safely", async () => {
    restores.push(setVerifiedEmailUserLookupForTests(async () => null));
    let reached = false;
    const missing = response();
    await requireVerifiedEmail(request(99), missing.res, (() => { reached = true; }) as NextFunction);
    assert.equal(missing.statusCode, 404);
    assert.equal(reached, false);
    const unauthenticated = response();
    await requireVerifiedEmail(request(), unauthenticated.res, (() => { reached = true; }) as NextFunction);
    assert.equal(unauthenticated.statusCode, 401);
  });

  it("passes ADMIN without imposing customer verification", async () => {
    let lookupCalled = false;
    restores.push(setVerifiedEmailUserLookupForTests(async () => { lookupCalled = true; return { emailVerified: false }; }));
    let reached = false;
    await requireVerifiedEmail(request(3, "ADMIN"), response().res, (() => { reached = true; }) as NextFunction);
    assert.equal(reached, true);
    assert.equal(lookupCalled, false);
  });
});
