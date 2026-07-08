import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// F6-E: active sessions — list + remote logout (single + all-others).

let app: FastifyInstance;
const uniq = Date.now().toString(36);
const PASSWORD = "BardzoBezpieczneHaslo123";
const EMAIL = `sessions-${uniq}@example.com`;

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function login(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: EMAIL, password: PASSWORD }
  });
  return res.json().accessToken;
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();
  await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email: EMAIL, password: PASSWORD, displayName: "Sessions User" }
  });
});

afterAll(async () => {
  await app.close();
});

describe("active sessions", () => {
  it("lists the current session and flags it", async () => {
    const token = await login();
    const res = await app.inject({ method: "GET", url: "/api/v1/me/sessions", headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const sessions = res.json() as { id: string; current: boolean }[];
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
  });

  it("revokes a single other session (its token stops working)", async () => {
    const tokenA = await login();
    const tokenB = await login();

    // From A's perspective, find B's session (the non-current one).
    const list = (await app.inject({ method: "GET", url: "/api/v1/me/sessions", headers: auth(tokenA) })).json() as {
      id: string;
      current: boolean;
    }[];
    const other = list.find((s) => !s.current);
    expect(other).toBeDefined();

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/me/sessions/${other!.id}`,
      headers: auth(tokenA)
    });
    expect(del.statusCode).toBe(200);

    // B's token is now rejected; A still works.
    const bAfter = await app.inject({ method: "GET", url: "/api/v1/me/sessions", headers: auth(tokenB) });
    expect(bAfter.statusCode).toBe(401);
    const aAfter = await app.inject({ method: "GET", url: "/api/v1/me/sessions", headers: auth(tokenA) });
    expect(aAfter.statusCode).toBe(200);
  });

  it("cannot revoke another user's session (404)", async () => {
    const token = await login();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/me/sessions/00000000-0000-0000-0000-000000000000`,
      headers: auth(token)
    });
    expect(res.statusCode).toBe(404);
  });

  it("revokes all other sessions, keeping the current one", async () => {
    const tokenA = await login();
    await login();
    await login();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/me/sessions/revoke-others",
      headers: auth(tokenA)
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().revoked).toBeGreaterThanOrEqual(2);

    const list = (await app.inject({ method: "GET", url: "/api/v1/me/sessions", headers: auth(tokenA) })).json() as {
      current: boolean;
    }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.current).toBe(true);
  });
});
