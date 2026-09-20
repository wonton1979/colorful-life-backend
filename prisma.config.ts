import "dotenv/config";
import { defineConfig, env } from "prisma/config";
import { resolveDatabaseUrl } from "./src/config/testDatabase.ts";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: resolveDatabaseUrl(process.env) ?? env("DATABASE_URL"),
  },
});
