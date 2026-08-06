import type { FastifyInstance } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { signAccessToken } from "../../lib/jwt.js";
import { generateRefreshToken, generateFamilyId, hashToken } from "../../lib/tokens.js";
import { hashPassword } from "../../lib/password.js";
import { revokeSession } from "../../plugins/auth-guard.js";
import { invalidateModuleCache } from "../../lib/modules.js";
import { logAudit } from "../../lib/audit.js";
import { env } from "../../config/env.js";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { OPTIONAL_MODULE_KEYS } from "@chatv2/shared";
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
  /**
   * Instancje Huba obsługiwane przez to wdrożenie. `HUB_INSTANCE_ID` przyjmuje listę
   * po przecinku — dane i tak są rozdzielane po organizacji (`org_slug` z biletu),
   * więc jedno wdrożenie może obsłużyć kilka firm (np. produkcyjną i demonstracyjną).
   */
  instanceIds: string[];
  clientId: string;
  clientSecret: string;
  webUrl: string;
  /** Optional HMAC secret to verify webhook signatures (x-wb-signature). */
  webhookSecret: string | null;
}

function getHubCfg(): HubCfg | null {
  const url = process.env.HUB_URL;
  const instanceIds = (process.env.HUB_INSTANCE_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const clientId = process.env.HUB_SSO_CLIENT_ID;
  const clientSecret = process.env.HUB_SSO_SECRET;
  if (!url || instanceIds.length === 0 || !clientId || !clientSecret) return null;
  return {
    url,
    instanceIds,
    clientId,
    clientSecret,
    issuer: process.env.HUB_ISSUER || "https://hub.wb.local",
    productKey: process.env.HUB_PRODUCT_KEY || "chat",
    webUrl: process.env.CHAT_WEB_URL || "http://localhost:5273",
    webhookSecret: process.env.HUB_WEBHOOK_SECRET || null,
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

  // Capture the raw JSON body (scoped to this plugin) so webhook HMAC
  // signatures can be verified against the exact bytes the Hub signed.
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      (req as unknown as { rawBody?: string }).rawBody = body as string;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  interface HubConfig {
    status: string;
    orgSlug: string;
    modules?: string[];
  }

  /** Fetch the authoritative instance config (status + enabled modules). */
  async function fetchHubConfig(instanceId: string): Promise<HubConfig | null> {
    try {
      const res = await fetch(`${cfg!.url}/api/v1/instances/${instanceId}/config`, {
        headers: { "x-sso-client-id": cfg!.clientId, "x-sso-secret": cfg!.clientSecret },
      });
      if (res.ok) return (await res.json()) as HubConfig;
    } catch (err) {
      fastify.log.warn({ err, instanceId }, "Hub: nie udało się pobrać konfiguracji instancji");
    }
    return null;
  }

  /**
   * Mirror the Hub's enabled-module list into OrganizationModule rows
   * (source="hub"). `modules` is the authoritative ENABLED set — every
   * optional key NOT present is disabled. Core keys are never persisted.
   */
  async function syncHubModules(orgSlug: string, modules: string[] | undefined) {
    if (!modules) return;
    const org = await fastify.prisma.organization.findUnique({ where: { slug: orgSlug } });
    if (!org) return;
    const enabled = new Set(modules);
    await Promise.all(
      OPTIONAL_MODULE_KEYS.map((key) =>
        fastify.prisma.organizationModule.upsert({
          where: { orgId_moduleKey: { orgId: org.id, moduleKey: key } },
          update: { enabled: enabled.has(key), source: "hub" },
          create: { orgId: org.id, moduleKey: key, enabled: enabled.has(key), source: "hub" },
        })
      )
    );
    await invalidateModuleCache(fastify, org.id);
  }

  /** Revoke every active session of an org's members (suspend / expiry). */
  async function revokeOrgSessions(orgSlug: string, reason: string) {
    const org = await fastify.prisma.organization.findUnique({ where: { slug: orgSlug } });
    if (!org) return;
    const members = await fastify.prisma.membership.findMany({ where: { orgId: org.id }, select: { userId: true } });
    const userIds = members.map((m) => m.userId);
    const sessions = await fastify.prisma.session.findMany({
      where: { userId: { in: userIds }, revokedAt: null },
      select: { id: true },
    });
    for (const s of sessions) {
      await fastify.prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
      await revokeSession(fastify, s.id, 3600);
    }
    fastify.log.info({ org: orgSlug, revoked: sessions.length, reason }, "Hub: unieważniono sesje organizacji");
  }

  /**
   * Unieważnia sesje wskazanych osób. Hub wysyła to przy odebraniu komuś
   * dostępu do produktu — bez tego odebranie dostępu w panelu WB Platform
   * nie wylogowywało z czatu i praca trwała do wygaśnięcia tokenu.
   */
  async function revokeUserSessions(emails: string[], reason: string) {
    if (emails.length === 0) return;
    const users = await fastify.prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true },
    });
    if (users.length === 0) return;

    const sessions = await fastify.prisma.session.findMany({
      where: { userId: { in: users.map((u) => u.id) }, revokedAt: null },
      select: { id: true },
    });
    for (const s of sessions) {
      await fastify.prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
      await revokeSession(fastify, s.id, 3600);
    }
    // Adresów nie logujemy — wystarczy liczba, żeby dziennik nie stał się
    // zbiorem danych osobowych.
    fastify.log.info({ users: users.length, revoked: sessions.length, reason }, "Hub: unieważniono sesje użytkowników");
  }

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
      if (!cfg.instanceIds.includes(String(payload.instance_id))) throw new Error("wrong instance");
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
    } else if (displayName && user.displayName !== displayName) {
      user = await prisma.user.update({ where: { id: user.id }, data: { displayName } });
    }

    let org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
    if (!org) {
      org = await prisma.organization.create({ data: { name: orgName, slug: orgSlug } });
    }

    // Hub jest źródłem prawdy o roli w organizacji, więc odświeżamy ją przy
    // każdym logowaniu. Wcześniej członkostwo zakładano tylko raz — awans lub
    // degradacja w Hubie nigdy nie docierały do czatu, a odebranie uprawnień
    // administratora pozostawało wyłącznie pozorne.
    const existingMembership = await prisma.membership.findUnique({
      where: { userId_orgId: { userId: user.id, orgId: org.id } },
    });
    if (!existingMembership) {
      await prisma.membership.create({ data: { userId: user.id, orgId: org.id, role } });
    } else if (existingMembership.role !== role || existingMembership.disabledAt) {
      await prisma.membership.update({
        where: { id: existingMembership.id },
        // Logowanie przez Hub oznacza aktywne członkostwo, więc zdejmujemy też
        // lokalną dezaktywację — inaczej konto zostałoby zablokowane na zawsze.
        data: { role, disabledAt: null },
      });
      await logAudit(fastify, {
        orgId: org.id,
        actorId: null,
        action: "hub.roleSynced",
        meta: { userId: user.id, from: existingMembership.role, to: role },
        ip: request.ip,
      });
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

    // 5. Zsynchronizuj włączone moduły z Huba (source="hub") — best-effort.
    const config = await fetchHubConfig(String(claims.instance_id));
    if (config) await syncHubModules(orgSlug, config.modules).catch((err) => request.log.warn({ err }, "Hub: sync modułów nieudany"));

    reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
    request.log.info({ email, org: orgSlug }, "Hub SSO: zalogowano");
    return reply.redirect(cfg.webUrl);
  });

  /**
   * Webhook z Huba (entitlements.updated). Nie ufamy treści — pobieramy
   * autorytatywny stan z Entitlements API, synchronizujemy moduły, a gdy
   * instancja jest suspended/expired NATYCHMIAST unieważniamy sesje członków.
   * Jeśli skonfigurowano HUB_WEBHOOK_SECRET, weryfikujemy podpis HMAC.
   */
  fastify.post("/webhook", async (request, reply) => {
    // Podpis HMAC nad dokładnymi bajtami, które podpisał Hub. Gdy sekret nie
    // jest skonfigurowany, punkt przyjmowałby żądania od kogokolwiek, więc
    // wtedy odmawiamy obsługi zamiast działać bez uwierzytelnienia.
    if (!cfg.webhookSecret) {
      request.log.error("Hub webhook: brak HUB_WEBHOOK_SECRET — żądanie odrzucone");
      return reply.code(503).send({ error: "WEBHOOK_NOT_CONFIGURED" });
    }
    const raw = (request as unknown as { rawBody?: string }).rawBody ?? "";
    const header = String(request.headers["x-wb-signature"] ?? "");
    const expected = "sha256=" + createHmac("sha256", cfg.webhookSecret).update(raw).digest("hex");
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      request.log.warn("Hub webhook: nieprawidłowy podpis HMAC");
      return reply.code(401).send({ error: "INVALID_SIGNATURE" });
    }

    const event = String(request.headers["x-wb-event"] ?? "");
    const body = request.body as { data?: { scope?: string; emails?: string[] } } | undefined;

    // Odebranie komuś dostępu w Hubie musi natychmiast zamknąć jego sesje.
    // Treści webhooka używamy wyłącznie do wskazania kogo dotyczy; o stan
    // instancji i tak pytamy Hub osobno.
    if (event === "session.revoked") {
      const data = body?.data;
      if (data?.scope === "users" && Array.isArray(data.emails)) {
        await revokeUserSessions(data.emails, "hub.access-revoked").catch((err) =>
          request.log.warn({ err }, "Hub webhook: unieważnianie sesji użytkowników nieudane")
        );
        return reply.send({ ok: true });
      }
    }

    // Webhook nie wskazuje instancji, więc uzgadniamy stan wszystkich obsługiwanych.
    for (const instanceId of cfg.instanceIds) {
      const config = await fetchHubConfig(instanceId);
      if (!config) continue;

      // Keep local module state in sync with the Hub (source of truth).
      await syncHubModules(config.orgSlug, config.modules).catch((err) =>
        request.log.warn({ err, instanceId }, "Hub webhook: sync modułów nieudany")
      );

      if (event === "session.revoked" || config.status === "suspended" || config.status === "expired") {
        await revokeOrgSessions(config.orgSlug, event === "session.revoked" ? "hub.session-revoked" : config.status);
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
