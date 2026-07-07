import { defineConfig, devices } from "@playwright/test";

/**
 * F5-F E2E smoke suite. Runs against a PRODUCTION build served via
 * `vite preview` rather than the dev server — per documented experience in
 * this project, dev-server HMR causes flaky click/hover timing in
 * automated browsers; a static preview build is far more stable.
 *
 * Requires the API (+ Postgres/Redis/MinIO) already running separately
 * (`pnpm --filter @chatv2/api dev` or the docker-compose stack) and seeded
 * with the standard test accounts (see prisma/seed.ts).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "pnpm build && pnpm preview -- --port 4173",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
