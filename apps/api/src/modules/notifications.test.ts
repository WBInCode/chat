import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// Notification preferences + push subscription CRUD (delivery itself needs
// a real push service, so this covers the API surface, not the network call).

let app: FastifyInstance;
const uniq = Date.now().toString(36);
const PASSWORD = "BardzoBezpieczneHaslo123";

interface Session {
  token: string;
  userId: string;
}

async function registerAndLogin(email: string, displayName: string): Promise<Session> {
  await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password: PASSWORD, displayName }
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: PASSWORD }
  });
  const body = login.json();
  return { token: body.accessToken, userId: body.user.id };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

let user: Session;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();
  user = await registerAndLogin(`notif-${uniq}@example.com`, "Notif User");
});

afterAll(async () => {
  await app.close();
});

describe("notification preferences", () => {
  it("defaults to ALL and can be changed", async () => {
    const get1 = await app.inject({
      method: "GET",
      url: "/api/v1/me/notification-preferences",
      headers: auth(user.token)
    });
    expect(get1.json().mode).toBe("ALL");

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/me/notification-preferences",
      headers: auth(user.token),
      payload: { mode: "MENTIONS" }
    });
    expect(patch.json().mode).toBe("MENTIONS");
  });

  it("rejects an invalid mode", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/me/notification-preferences",
      headers: auth(user.token),
      payload: { mode: "BOGUS" }
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("push subscriptions", () => {
  const endpoint = `https://push.example.com/${uniq}`;

  it("returns the VAPID public key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/push/vapid-public-key",
      headers: auth(user.token)
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().publicKey === "string" || res.json().publicKey === null).toBe(true);
  });

  it("registers and removes a subscription", async () => {
    const sub = await app.inject({
      method: "POST",
      url: "/api/v1/me/push-subscribe",
      headers: auth(user.token),
      payload: { endpoint, keys: { p256dh: "p256dh-value", auth: "auth-value" } }
    });
    expect(sub.statusCode).toBe(201);

    const unsub = await app.inject({
      method: "POST",
      url: "/api/v1/me/push-unsubscribe",
      headers: auth(user.token),
      payload: { endpoint }
    });
    expect(unsub.statusCode).toBe(204);
  });
});

describe("unread summary", () => {
  it("returns zero counts for a brand-new user", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me/unread-summary",
      headers: auth(user.token)
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ totalUnread: 0, mentionCount: 0, channelCount: 0 });
  });
});
