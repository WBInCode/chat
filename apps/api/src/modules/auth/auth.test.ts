import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

// Integration tests against real Postgres + Redis from docker-compose.
// Each run uses a unique email so tests are repeatable without cleanup.

let app: FastifyInstance;
const uniq = Date.now().toString(36);
const EMAIL = `authtest-${uniq}@example.com`;
const PASSWORD = "BardzoBezpieczneHaslo123";
const DISPLAY_NAME = "Auth Tester";

function extractRefreshCookie(setCookieHeader: string | string[] | undefined): string {
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader ?? ""];
  const rt = cookies.find((c) => c.startsWith("chatv2_rt="));
  expect(rt, "refresh cookie should be set").toBeTruthy();
  return (rt as string).split(";")[0] as string;
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("POST /api/v1/auth/register", () => {
  it("creates a user with valid input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: EMAIL, password: PASSWORD, displayName: DISPLAY_NAME }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe(EMAIL);
    expect(body.user).not.toHaveProperty("passwordHash");
  });

  it("rejects a duplicate email with 409 and no detail leak", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: EMAIL, password: PASSWORD, displayName: DISPLAY_NAME }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EMAIL_TAKEN");
  });

  it("rejects passwords shorter than 12 chars", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: `short-${uniq}@example.com`, password: "krotkie1", displayName: "X Y" }
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/auth/login", () => {
  it("returns access token and sets httpOnly refresh cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: EMAIL, password: PASSWORD }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toMatch(/^eyJ/);

    const setCookie = res.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
    expect(cookieStr).toContain("chatv2_rt=");
    expect(cookieStr).toContain("HttpOnly");
    expect(cookieStr).toContain("SameSite=Strict");
  });

  it("rejects wrong password with generic message", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: EMAIL, password: "ZupelnieZleHaslo123" }
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("responds identically for a non-existent account (no user enumeration)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: `nieistnieje-${uniq}@example.com`, password: "JakiesHaslo12345" }
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("GET /api/v1/auth/me", () => {
  it("returns profile with valid token, rejects without token", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: EMAIL, password: PASSWORD }
    });
    const { accessToken } = login.json();

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(EMAIL);

    const anon = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
    expect(anon.statusCode).toBe(401);

    const badToken = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: "Bearer nieprawidlowy.token.xyz" }
    });
    expect(badToken.statusCode).toBe(401);
  });
});

describe("POST /api/v1/auth/refresh — rotation & reuse detection", () => {
  it("w oknie tolerancji powtórka zużytego tokenu oddaje tę samą parę", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: EMAIL, password: PASSWORD }
    });
    const oldCookie = extractRefreshCookie(login.headers["set-cookie"]);

    const refresh1 = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: oldCookie }
    });
    expect(refresh1.statusCode).toBe(200);
    const newCookie = extractRefreshCookie(refresh1.headers["set-cookie"]);
    expect(newCookie).not.toBe(oldCookie);

    // Druga karta wysyła ten sam token ułamek sekundy później. Dostaje tę samą
    // parę co zwycięzca wyścigu, zamiast wysadzić całą rodzinę sesji.
    const race = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: oldCookie }
    });
    expect(race.statusCode).toBe(200);
    expect(extractRefreshCookie(race.headers["set-cookie"])).toBe(newCookie);

    // Sesja żyje dalej — token wydany zwycięzcy nadal działa.
    const afterRace = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: newCookie }
    });
    expect(afterRace.statusCode).toBe(200);
  });

  it("po wygaśnięciu okna tolerancji powtórka kasuje całą rodzinę", async () => {
    const email = `graceless-${Date.now().toString(36)}@example.com`;
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email, password: PASSWORD, displayName: DISPLAY_NAME }
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: PASSWORD }
    });
    const oldCookie = extractRefreshCookie(login.headers["set-cookie"]);

    const refresh1 = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: oldCookie }
    });
    expect(refresh1.statusCode).toBe(200);
    const newCookie = extractRefreshCookie(refresh1.headers["set-cookie"]);

    // Symulacja upływu okna: kasujemy wpis tolerancji, reszta stanu bez zmian.
    const graceKeys = await app.redis.keys("refresh-grace:*");
    if (graceKeys.length > 0) await app.redis.del(...graceKeys);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: oldCookie }
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe("REFRESH_REUSE_DETECTED");

    // Cała rodzina unieważniona — nowy token też przestaje działać.
    const afterBreach = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: newCookie }
    });
    expect(afterBreach.statusCode).toBe(401);
    expect(afterBreach.json().error.code).toBe("REFRESH_REUSE_DETECTED");
  });

  it("rejects refresh without a cookie", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/refresh" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("NO_REFRESH_TOKEN");
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("revokes session — access token stops working immediately", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: EMAIL, password: PASSWORD }
    });
    const { accessToken } = login.json();
    const cookie = extractRefreshCookie(login.headers["set-cookie"]);

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { authorization: `Bearer ${accessToken}`, cookie }
    });
    expect(logout.statusCode).toBe(204);

    // Access token is now revoked via Redis denylist despite valid signature.
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    expect(me.statusCode).toBe(401);

    // Refresh token was also revoked.
    const refresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie }
    });
    expect(refresh.statusCode).toBe(401);
  });

  it("działa na samym ciasteczku, bez ważnego access tokenu", async () => {
    const email = `logout-nocookie-${Date.now().toString(36)}@example.com`;
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email, password: PASSWORD, displayName: DISPLAY_NAME }
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: PASSWORD }
    });
    const cookie = extractRefreshCookie(login.headers["set-cookie"]);

    // Bez nagłówka Authorization — tak wygląda wylogowanie po dłuższej
    // bezczynności, gdy access token dawno wygasł.
    const logout = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie } });
    expect(logout.statusCode).toBe(204);

    const refresh = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: { cookie } });
    expect(refresh.statusCode).toBe(401);
  });
});
