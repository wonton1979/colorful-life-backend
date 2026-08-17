import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { getInventoryMovements } from "../controllers/products.js";

// Simple mock for Express Request/Response
function mockRes() {
  const res: any = {};
  res.statusCode = 200;
  res.jsonData = null;
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data: any) => {
    res.jsonData = data;
    return res;
  };
  return res;
}

describe("getInventoryMovements controller", () => {
  it("should return 404 for invalid listing id", async () => {
    const req: any = { params: { id: "-5" } };
    const res = mockRes();
    await getInventoryMovements(req, res);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.jsonData, { error: "Listing not found" });
  });
});
