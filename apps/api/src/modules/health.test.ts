import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// F5-F: health/readiness checks now report per-dependency status.

let app: FastifyInstance;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("Health checks (F5-F)", () => {
  it("GET /health returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  it("GET /health/ready reports per-dependency checks", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health/ready" });
    expect([200, 503]).toContain(res.statusCode);
    const body = res.json();
    expect(body.checks).toHaveProperty("database");
    expect(body.checks).toHaveProperty("redis");
    expect(body.checks).toHaveProperty("storage");
  });

  it("/metrics is disabled under NODE_ENV=test (avoids queue/redis reads in CI)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/metrics" });
    expect(res.statusCode).toBe(404);
  });
});
