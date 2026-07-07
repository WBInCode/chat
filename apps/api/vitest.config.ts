import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    // Auth tests hit a real Postgres+Redis (docker compose); run serially
    // to avoid cross-test interference on shared state.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    setupFiles: ["./vitest.setup.ts"]
  }
});
