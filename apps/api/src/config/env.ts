import { z } from "zod";
import "dotenv/config";

/**
 * Wartosc logiczna ze zmiennej srodowiskowej. Swiadomie nie uzywamy
 * z.coerce.boolean(), bo ono robi Boolean("false") czyli true — wpisanie
 * SMTP_SECURE=false wlaczyloby TLS zamiast go wylaczyc.
 */
const wartoscLogiczna = (domyslna: boolean) =>
  z
    .enum(["true", "false"])
    .default(domyslna ? "true" : "false")
    .transform((v) => v === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CORS_ORIGIN: z.string().min(1),
  // Prefer inline PEM keys (works reliably on ephemeral hosts like Render);
  // fall back to reading from a file path when the inline vars are absent.
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_PRIVATE_KEY_PATH: z.string().default("./apps/api/keys/jwt_private.pem"),
  JWT_PUBLIC_KEY_PATH: z.string().default("./apps/api/keys/jwt_public.pem"),
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
  GOTENBERG_URL: z.string().default("http://localhost:3012"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:admin@chatv2.local"),
  // Powiadomienia e-mail. Bez konfiguracji SMTP caly mechanizm jest wylaczony
  // (no-op, tak jak push bez kluczy VAPID) — nigdy nie wywraca wysylki wiadomosci.
  //
  // Preferowane sa osobne zmienne, bo haslo w adresie URL wycieka przy kazdym
  // wypisaniu konfiguracji, w logach i na zrzutach ekranu. SMTP_URL zostaje dla
  // zgodnosci wstecz i jest uzywany tylko wtedy, gdy nie podano SMTP_HOST.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: wartoscLogiczna(true),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** Zgodnosc wstecz. Format: smtp://user:pass@host:587 albo smtps://... dla TLS. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Chat WB Platform <chat@wb-platform.pl>"),
  /** Baza linków w e-mailach; domyślnie pierwszy wpis CORS_ORIGIN. */
  APP_PUBLIC_URL: z.string().optional(),
  /** Twardy dzienny limit e-maili na osobę — ostatni bezpiecznik antyspamowy. */
  MAIL_DAILY_LIMIT_PER_USER: z.coerce.number().int().positive().default(20),
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  AI_DAILY_LIMIT: z.coerce.number().int().positive().default(300),
  // SSO-only: gdy true, lokalna rejestracja i logowanie hasłem są wyłączone —
  // dostęp wyłącznie przez SSO z Hubem (wb-platform).
  AUTH_SSO_ONLY: z.coerce.boolean().default(false)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
