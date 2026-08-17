import { test } from "node:test";
import assert from "node:assert";
import { adjustInventory } from "../controllers/products.js";

/**
 * Simple mock of Express `Response` used by the controller.
 * Captures status code and the JSON payload sent.
 */
function createMockRes() {
  let statusCode = 200;
  let payload: any = null;
  const res: any = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: any) => {
      payload = data;
    },
  };
  return { res, get statusCode() { return statusCode; }, get payload() { return payload; } };
}

test("adjustInventory returns 401 when no authenticated user", async () => {
  const req = {
    params: { id: "1" },
    body: { quantity: 5 },
    user: null,
  } as any;
  const mock = createMockRes();
  await adjustInventory(req, mock.res as any);
  assert.strictEqual(mock.statusCode, 401);
  assert.deepStrictEqual(mock.payload, { error: "Unauthorized" });
});

test("adjustInventory returns 400 when quantity is zero", async () => {
  const req = {
    params: { id: "1" },
    body: { quantity: 0 },
    user: { id: 123 },
  } as any;
  const mock = createMockRes();
  await adjustInventory(req, mock.res as any);
  assert.strictEqual(mock.statusCode, 400);
  assert.ok(mock.payload && mock.payload.error);
});
