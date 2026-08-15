import { z } from "zod";
import { config as dotenvConfig } from "dotenv";

// Load environment variables from .env if present
dotenvConfig();

// Schema for configuration validation
const configSchema = z.object({
  PORT: z
    .preprocess((val) => (val ? Number(val) : 3000),
      z.number().int().positive()
    ),
  DATABASE_URL: z.string().nonempty(),
});

const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment configuration:", parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;