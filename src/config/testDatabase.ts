type Environment = Readonly<Record<string, string | undefined>>;

export const TEST_DATABASE_NAME = "colorful_life_test";

export class UnsafeTestDatabaseError extends Error {
  constructor(message: string) {
    super(`Unsafe test database configuration: ${message}`);
    this.name = "UnsafeTestDatabaseError";
  }
}

function parseDatabaseUrl(value: string | undefined, variable: string) {
  if (!value) throw new UnsafeTestDatabaseError(`${variable} is required`);
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname ||
        !url.pathname.slice(1) || url.hash || /\s/.test(value)) {
      throw new Error("Invalid PostgreSQL URL");
    }
    return { url, database: decodeURIComponent(url.pathname.slice(1)) };
  } catch {
    // Never include URLs or parser errors: they can contain credentials.
    throw new UnsafeTestDatabaseError(`${variable} must be an explicit PostgreSQL database URL`);
  }
}

/** Pure validation: no environment mutation, Prisma import, or database connection. */
export function validateTestDatabase(env: Environment) {
  if (env.NODE_ENV?.toLowerCase() === "production") {
    throw new UnsafeTestDatabaseError("tests and test migrations cannot run in production mode");
  }
  const test = parseDatabaseUrl(env.TEST_DATABASE_URL, "TEST_DATABASE_URL");
  const normal = parseDatabaseUrl(env.DATABASE_URL, "DATABASE_URL");
  // Compare database names, not URL strings: different credentials, host aliases,
  // encodings, or query parameters must not disguise the normal database.
  if (test.database === normal.database) {
    throw new UnsafeTestDatabaseError("test and normal database names must differ");
  }
  if (test.database !== TEST_DATABASE_NAME) {
    throw new UnsafeTestDatabaseError(`TEST_DATABASE_URL must target exactly ${TEST_DATABASE_NAME}`);
  }
  const seen = new Set<string>();
  for (const [key, value] of test.url.searchParams) {
    const allowed = (key === "schema" && value === "public") ||
      (key === "sslmode" && ["disable", "require", "verify-ca", "verify-full"].includes(value));
    if (!allowed || seen.has(key)) {
      throw new UnsafeTestDatabaseError("only schema=public and a single supported sslmode parameter are allowed");
    }
    seen.add(key);
  }
  return { url: env.TEST_DATABASE_URL!, database: TEST_DATABASE_NAME };
}

export function isTestExecution(env: Environment, argv: readonly string[] = process.argv) {
  return env.NODE_ENV === "test" || env.NODE_TEST_CONTEXT !== undefined ||
    argv.includes("--test") || /\.test\.[cm]?[jt]s$/.test(argv[1] ?? "");
}

/** Called while configuration loads, before the shared Prisma client is constructed. */
export function resolveDatabaseUrl(env: Environment, argv: readonly string[] = process.argv) {
  return isTestExecution(env, argv) ? validateTestDatabase(env).url : env.DATABASE_URL;
}
