import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Bez HUB_WEBHOOK_SECRET punkt webhooka przyjmowałby żądania od kogokolwiek
// z internetu. Każde wywołanie generuje ruch do Huba i zapisy do bazy, więc
// nadaje się do męczenia usługi — dlatego brak sekretu ma oznaczać odmowę.

let app: FastifyInstance;
let realFetch: typeof globalThis.fetch;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.HUB_URL = "http://hub.local";
  process.env.HUB_INSTANCE_ID = "inst-bez-sekretu";
  process.env.HUB_SSO_CLIENT_ID = "chat";
  process.env.HUB_SSO_SECRET = "sekret";
  delete process.env.HUB_WEBHOOK_SECRET;

  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => {
    throw new Error("nie powinno dojsc do zadnego wyjscia na zewnatrz");
  }) as unknown as typeof globalThis.fetch;

  const { buildApp } = await import("../app.js");
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  globalThis.fetch = realFetch;
  for (const key of ["HUB_URL", "HUB_INSTANCE_ID", "HUB_SSO_CLIENT_ID", "HUB_SSO_SECRET"]) {
    delete process.env[key];
  }
});

describe("webhook Huba bez skonfigurowanego sekretu", () => {
  it("odmawia obsługi zamiast działać bez uwierzytelnienia", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sso/webhook",
      headers: { "content-type": "application/json", "x-wb-event": "entitlements.updated" },
      payload: JSON.stringify({ event: "entitlements.updated" })
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("WEBHOOK_NOT_CONFIGURED");
    // Żadne żądanie do Huba nie mogło wyjść — mock rzuciłby wyjątek.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
