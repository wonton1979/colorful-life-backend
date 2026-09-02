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
    JWT_SECRET: z.string().nonempty(),
    JWT_EXPIRES_IN: z.string().nonempty().default("1h"),
    AWS_REGION: z.string().nonempty().default("eu-west-2"),
    SES_FROM_EMAIL: z.string().email().default("noreply@example.com"),
    FRONTEND_URL: z.string().url().default("http://localhost:3000"),
    IDEAL_POSTCODES_API_KEY: z.string().nonempty().optional(),
  });

const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment configuration:", parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
