import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { resolveDatabaseUrl, validateTestDatabase } from "../config/testDatabase.js";

const developmentUrl = "postgres://normal:secret@localhost:5432/colorful_life";
const testUrl = "postgres://tester:secret@localhost:5432/colorful_life_test";
const valid = { DATABASE_URL: developmentUrl, TEST_DATABASE_URL: testUrl };

describe("test database safety (no database connections)", () => {
  for (const [name, overrides] of Object.entries({
    "missing test URL": { TEST_DATABASE_URL: undefined },
    "empty test URL": { TEST_DATABASE_URL: "" },
    "missing normal URL": { DATABASE_URL: undefined },
    "same development URL": { TEST_DATABASE_URL: developmentUrl },
    "same test and normal URL": { DATABASE_URL: testUrl },
    "same database with different credentials and host spelling": { DATABASE_URL: "postgresql://other:other@127.0.0.1/colorful_life_test" },
    "known development database on another host": { TEST_DATABASE_URL: "postgres://tester:secret@another-host/colorful_life" },
    "production database": { TEST_DATABASE_URL: "postgres://tester:secret@localhost/colorful_life_production" },
    "production mode with a test-named database": { NODE_ENV: "production" },
    "arbitrary test suffix": { TEST_DATABASE_URL: "postgres://tester:secret@localhost/other_test" },
    "missing database name": { TEST_DATABASE_URL: "postgres://tester:secret@localhost" },
    "non-PostgreSQL protocol": { TEST_DATABASE_URL: "https://localhost/colorful_life_test" },
    "malformed URL": { TEST_DATABASE_URL: "not-a-url-with-secret" },
    "ambiguous whitespace": { TEST_DATABASE_URL: `${testUrl} ` },
    "alternate schema": { TEST_DATABASE_URL: `${testUrl}?schema=development` },
    "host override": { TEST_DATABASE_URL: `${testUrl}?host=production` },
    "database override": { TEST_DATABASE_URL: `${testUrl}?dbname=colorful_life` },
    "connection options override": { TEST_DATABASE_URL: `${testUrl}?options=-csearch_path=development` },
    "repeated query parameter": { TEST_DATABASE_URL: `${testUrl}?schema=public&schema=public` },
    "URL fragment": { TEST_DATABASE_URL: `${testUrl}#ignored` },
  })) {
    it(`rejects ${name}`, () => {
      assert.throws(() => validateTestDatabase({ ...valid, ...overrides }), /Unsafe test database configuration/);
    });
  }

  it("accepts the explicitly named test database without mutating the environment", () => {
    const env = Object.freeze({ ...valid });
    assert.deepEqual(validateTestDatabase(env), { url: testUrl, database: "colorful_life_test" });
    assert.equal(env.DATABASE_URL, developmentUrl);
    assert.equal(validateTestDatabase({ ...valid, TEST_DATABASE_URL: `${testUrl}?schema=public&sslmode=require` }).database, "colorful_life_test");
  });

  it("preserves development and production URL selection outside tests", () => {
    assert.equal(resolveDatabaseUrl({ ...valid, NODE_ENV: "development" }, []), developmentUrl);
    assert.equal(resolveDatabaseUrl({ ...valid, NODE_ENV: "production" }, []), developmentUrl);
  });

  it("guards NODE_ENV=test, Node test workers, and directly executed test files", () => {
    for (const [extra, argv] of [
      [{ NODE_ENV: "test" }, []],
      [{ NODE_TEST_CONTEXT: "child-v8" }, []],
      [{}, ["node", "dist/__tests__/example.test.js"]],
      [{}, ["node", "--test"]],
    ] as const) {
      assert.equal(resolveDatabaseUrl({ ...valid, ...extra }, argv), testUrl);
      assert.throws(() => resolveDatabaseUrl({ ...valid, ...extra, TEST_DATABASE_URL: undefined }, argv), /TEST_DATABASE_URL is required/);
    }
  });

  it("does not disclose credentials in validation errors", () => {
    assert.throws(() => validateTestDatabase({ ...valid, TEST_DATABASE_URL: "postgres://tester:do-not-disclose@" }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes("do-not-disclose"));
      assert.ok(!error.stack?.includes("do-not-disclose"));
      return true;
    });
  });

  function childEnv(overrides: NodeJS.ProcessEnv = {}) {
    const env: NodeJS.ProcessEnv = { ...process.env, ...valid, JWT_SECRET: "database-safety-test-only", NODE_ENV: "test", ...overrides };
    delete env.NODE_TEST_CONTEXT;
    return env;
  }

  it("selects the test URL before Prisma construction without connecting", () => {
    const runtime = new URL("../prisma/runtime.js", import.meta.url).href;
    const config = new URL("../config/index.js", import.meta.url).href;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      const { config } = await import(${JSON.stringify(config)});
      const { prisma } = await import(${JSON.stringify(runtime)});
      if (config.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Wrong Prisma configuration");
      if (process.env.DATABASE_URL === config.DATABASE_URL) throw new Error("Normal URL overwritten");
      await prisma.$disconnect();
      console.log("test-runtime-selected");
    `], { env: childEnv(), encoding: "utf8", timeout: 10_000 });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /test-runtime-selected/);
  });

  it("blocks direct test execution before controller tests can run", () => {
    const file = fileURLToPath(new URL("./products.adjustInventory.test.js", import.meta.url));
    const child = spawnSync(process.execPath, [file], {
      env: childEnv({ NODE_ENV: "development", TEST_DATABASE_URL: "" }), encoding: "utf8", timeout: 10_000,
    });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /TEST_DATABASE_URL is required/);
    assert.doesNotMatch(child.stdout, /Subtest:/);
  });

  for (const mode of ["check", "prepare", "run"]) {
    it(`blocks the ${mode} command before migrations or tests on an unsafe target`, () => {
      const script = fileURLToPath(new URL("../testing/runTests.js", import.meta.url));
      const child = spawnSync(process.execPath, [script, mode], {
        env: childEnv({ TEST_DATABASE_URL: developmentUrl }), encoding: "utf8", timeout: 10_000,
      });
      assert.equal(child.status, 1);
      assert.match(child.stderr, /Unsafe test database configuration/);
      assert.doesNotMatch(child.stdout, /Validated test database|migrations|TAP version/);
      assert.ok(!child.stderr.includes("secret"));
    });
  }
});
