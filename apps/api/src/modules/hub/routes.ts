import type { FastifyInstance } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { signAccessToken } from "../../lib/jwt.js";
import { generateRefreshToken, generateFamilyId, hashToken } from "../../lib/tokens.js";
import { hashPassword } from "../../lib/password.js";
import { revokeSession } from "../../plugins/auth-guard.js";
import { env } from "../../config/env.js";
import { randomBytes } from "node:crypto";
import type { OrgRole } from "@prisma/client";

/**
 * Integracja SSO z Hubem (wb-platform) — ADDYTYWNA. Lokalne logowanie chatu
 * pozostaje nietknięte. Aktywna tylko gdy ustawione zmienne HUB_* .
 *
 * Przepływ: Hub przekierowuje tu z krótkożyjącym biletem → weryfikacja przez
 * JWKS Huba → redeem (jednorazowość) → JIT provisioning (user + org + członkostwo)
 * → wystawienie WŁASNEJ sesji chatu (refresh cookie) → redirect na web.
 * Web (silent restore przez /auth/refresh) sam się loguje — bez podawania hasła.
 */

interface HubCfg {
  url: string;
  issuer: string;
  productKey: string;
  instanceId: string;
  clientId: string;
  clientSecret: string;
  webUrl: string;
}

function getHubCfg(): HubCfg | null {
  const url = process.env.HUB_URL;
  const instanceId = process.env.HUB_INSTANCE_ID;
  const clientId = process.env.HUB_SSO_CLIENT_ID;
  const clientSecret = process.env.HUB_SSO_SECRET;
  if (!url || !instanceId || !clientId || !clientSecret) return null;
  return {
    url,
    instanceId,
    clientId,
    clientSecret,
    issuer: process.env.HUB_ISSUER || "https://hub.wb.local",
    productKey: process.env.HUB_PRODUCT_KEY || "chat",
    webUrl: process.env.CHAT_WEB_URL || "http://localhost:5273",
  };
}

const REFRESH_COOKIE_NAME = "chatv2_rt";

function mapRole(orgRole: string): OrgRole {
  const r = (orgRole || "").toUpperCase();
  if (r === "OWNER") return "OWNER";
  if (r === "ADMIN") return "ADMIN";
  if (r === "HR") return "HR";
  return "MEMBER";
}

export default async function hubSsoRoutes(fastify: FastifyInstance) {
  const cfg = getHubCfg();
  if (!cfg) {
    fastify.log.info("Hub SSO wyłączone (brak zmiennych HUB_*).");
    return;
  }

  const jwks = createRemoteJWKSet(new URL(`${cfg.url}/.well-known/jwks.json`));

  function refreshCookieOptions() {
    const isProd = env.NODE_ENV === "production";
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: (isProd ? "none" : "strict") as "none" | "strict",
      path: "/api/v1/auth",
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
    };
  }

  fastify.get("/callback", async (request, reply) => {
    const token = (request.query as { token?: string }).token;
    if (!token) return reply.redirect(`${cfg.webUrl}/login?sso_error=missing`);

    // 1. Weryfikacja podpisu przez JWKS Huba.
    let claims;
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer: cfg.issuer, audience: cfg.productKey });
      if ((payload as { typ?: string }).typ !== "handoff") throw new Error("not handoff");
      if (String(payload.instance_id) !== cfg.instanceId) throw new Error("wrong instance");
      claims = payload;
    } catch (err) {
      request.log.warn({ err }, "Hub SSO: odrzucony bilet");
      return reply.redirect(`${cfg.webUrl}/login?sso_error=invalid`);
    }

    // 2. Redeem (server-to-server) — jednorazowość.
    try {
      const res = await fetch(`${cfg.url}/api/v1/sso/redeem`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-sso-client-id": cfg.clientId, "x-sso-secret": cfg.clientSecret },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error(`redeem ${res.status}`);
    } catch (err) {
      request.log.warn({ err }, "Hub SSO: redeem nieudany");
      return reply.redirect(`${cfg.webUrl}/login?sso_error=used`);
    }

    const email = String(claims.email);
    const displayName = String(claims.name) || email;
    const orgSlug = String(claims.org_slug) || `hub-${String(claims.org_id).slice(0, 8)}`;
    const orgName = String(claims.org_name) || "Organizacja";
    const role = mapRole(String(claims.org_role));

    // 3. JIT provisioning: user + organizacja + członkostwo.
    const prisma = fastify.prisma;
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: { email, displayName, passwordHash: await hashPassword(randomBytes(24).toString("hex")) },
      });
    }

    let org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
    if (!org) {
      org = await prisma.organization.create({ data: { name: orgName, slug: orgSlug } });
    }

    const existingMembership = await prisma.membership.findFirst({ where: { userId: user.id, orgId: org.id } });
    if (!existingMembership) {
      await prisma.membership.create({ data: { userId: user.id, orgId: org.id, role } });
    }

    // 4. Własna sesja chatu (refresh rotation jak w natywnym logowaniu).
    const refreshToken = generateRefreshToken();
    const familyId = generateFamilyId();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        refreshHash: hashToken(refreshToken),
        familyId,
        userAgent: request.headers["user-agent"] ?? null,
        ip: request.ip,
        expiresAt,
      },
    });
    await signAccessToken({ sub: user.id, sid: session.id }); // rozgrzewa klucz; token wyda /refresh

    reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
    request.log.info({ email, org: orgSlug }, "Hub SSO: zalogowano");
    return reply.redirect(cfg.webUrl);
  });

  /**
   * Webhook z Huba (entitlements.updated / suspend). Nie ufamy treści — pobieramy
   * autorytatywny stan z Entitlements API. Gdy instancja zawieszona, NATYCHMIAST
   * unieważniamy sesje członków organizacji (blocklist Redis + revokedAt).
   */
  fastify.post("/webhook", async (request, reply) => {
    let config: { status: string; orgSlug: string } | null = null;
    try {
      const res = await fetch(`${cfg.url}/api/v1/instances/${cfg.instanceId}/config`, {
        headers: { "x-sso-client-id": cfg.clientId, "x-sso-secret": cfg.clientSecret },
      });
      if (res.ok) config = (await res.json()) as { status: string; orgSlug: string };
    } catch (err) {
      request.log.warn({ err }, "Hub webhook: nie udało się pobrać konfiguracji");
    }
    if (!config) return reply.send({ ok: true });

    if (config.status === "suspended") {
      const org = await fastify.prisma.organization.findUnique({ where: { slug: config.orgSlug } });
      if (org) {
        const members = await fastify.prisma.membership.findMany({ where: { orgId: org.id }, select: { userId: true } });
        const userIds = members.map((m) => m.userId);
        const sessions = await fastify.prisma.session.findMany({
          where: { userId: { in: userIds }, revokedAt: null },
          select: { id: true },
        });
        for (const s of sessions) {
          await fastify.prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
          await revokeSession(fastify, s.id, 3600); // blokada > TTL access tokena
        }
        request.log.info({ org: config.orgSlug, revoked: sessions.length }, "Hub: zawieszenie — unieważniono sesje");
      }
    }
    return reply.send({ ok: true });
  });

  /**
   * Single logout (back-channel). Hub podpisuje token logout, my weryfikujemy go
   * przez JWKS i unieważniamy WSZYSTKIE sesje danego użytkownika (Redis + revokedAt).
   */
  fastify.post("/logout", async (request, reply) => {
    const token = (request.body as { token?: string })?.token;
    if (!token) return reply.code(400).send({ error: "MISSING_TOKEN" });
    let email: string;
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer: cfg.issuer, audience: cfg.productKey });
      if ((payload as { typ?: string }).typ !== "logout") throw new Error("not logout");
      email = String(payload.email);
    } catch {
      return reply.code(401).send({ error: "INVALID_TOKEN" });
    }

    const user = await fastify.prisma.user.findUnique({ where: { email } });
    if (user) {
      const sessions = await fastify.prisma.session.findMany({ where: { userId: user.id, revokedAt: null }, select: { id: true } });
      for (const s of sessions) {
        await fastify.prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
        await revokeSession(fastify, s.id, 3600);
      }
      request.log.info({ email, revoked: sessions.length }, "Hub: single logout — unieważniono sesje");
    }
    return reply.send({ ok: true });
  });
}
