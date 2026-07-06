import { z } from "zod";
import "dotenv/config";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CORS_ORIGIN: z.string().min(1),
  JWT_PRIVATE_KEY_PATH: z.string().min(1),
  JWT_PUBLIC_KEY_PATH: z.string().min(1),
  JWT_ACCESS_TTL: z.string().default("10m"),
  JWT_ISSUER: z.string().default("chatv2"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  COOKIE_SECRET: z.string().min(32, "COOKIE_SECRET must be >= 32 chars"),
  FIELD_ENCRYPTION_KEY: z.string().min(1),
  S3_ENDPOINT: z.string().default("http://localhost:9010"),
  S3_ACCESS_KEY: z.string().default("chatv2"),
  S3_SECRET_KEY: z.string().default("chatv2_dev_password"),
  S3_BUCKET: z.string().default("chatv2-files"),
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  CLAMAV_HOST: z.string().default("localhost"),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3311),
  GOTENBERG_URL: z.string().default("http://localhost:3012")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
