import { PrismaClient } from "../generated/prisma-client/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
// Import configuration with explicit .js extension to satisfy Node's ESM resolver.
// The original source omitted the extension which works when bundled, but
// fails when running the compiled JavaScript directly. Using the .js
// suffix ensures compatibility when the project is executed with `node`.
import { config } from "../config/index.js";

const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });