import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, type JWK } from "jose";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";

// Logowanie przez Hub: rola w organizacji ma być odświeżana przy każdym
// wejściu, bo to Hub jest źródłem prawdy. Wcześniej członkostwo zakładano
// tylko raz i awans ani degradacja nigdy nie docierały do czatu.

const uniq = Date.now().toString(36);
const SLUG = `hub-role-${uniq}`;
const EMAIL = `hub-role-${uniq}@example.com`;
const ISSUER = "https://hub.test";
const PRODUCT = "chat";
const INSTANCE = `inst-${uniq}`;

let app: FastifyInstance;
let realFetch: typeof globalThis.fetch;
// Typ klucza bierzemy z jose — build API nie ma w lib typu CryptoKey.
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let publicJwk: JWK;
let jwksServer: Server;

beforeAll(async () => {
  process.env.NODE_ENV = "test";

  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "EdDSA", use: "sig" };

  // jose w Node pobiera JWKS własnym klientem HTTP, więc podmiana globalnego
  // fetch go nie obejmuje — potrzebny jest prawdziwy serwer pod HUB_URL.
  jwksServer = createServer((req, res) => {
    if (req.url?.startsWith("/.well-known/jwks.json")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
  const port = (jwksServer.address() as AddressInfo).port;

  process.env.HUB_URL = `http://127.0.0.1:${port}`;
  process.env.HUB_INSTANCE_ID = INSTANCE;
  process.env.HUB_SSO_CLIENT_ID = "chat";
  process.env.HUB_SSO_SECRET = "sekret";
  process.env.HUB_ISSUER = ISSUER;
  process.env.HUB_PRODUCT_KEY = PRODUCT;

  // Redeem i pobranie konfiguracji idą przez globalny fetch — te podmieniamy.
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/sso/redeem")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.includes("/config")) {
      return new Response(JSON.stringify({ status: "active", orgSlug: SLUG, modules: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return realFetch(input, init);
  }) as typeof globalThis.fetch;

  const { buildApp } = await import("../app.js");
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  globalThis.fetch = realFetch;
  for (const key of [
    "HUB_URL",
    "HUB_INSTANCE_ID",
    "HUB_SSO_CLIENT_ID",
    "HUB_SSO_SECRET",
    "HUB_ISSUER",
    "HUB_PRODUCT_KEY"
  ]) {
    delete process.env[key];
  }
});

/** Bilet handoff podpisany kluczem, który mock JWKS wystawia jako publiczny. */
async function handoffToken(orgRole: string, overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    typ: "handoff",
    email: EMAIL,
    name: "Osoba z Huba",
    org_slug: SLUG,
    org_name: "Organizacja z Huba",
    org_role: orgRole,
    instance_id: INSTANCE,
    ...overrides
  })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(PRODUCT)
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(privateKey);
}

async function loginAs(orgRole: string, overrides: Record<string, unknown> = {}) {
  const token = await handoffToken(orgRole, overrides);
  return app.inject({ method: "GET", url: `/api/v1/sso/callback?token=${encodeURIComponent(token)}` });
}

async function membership() {
  const org = await app.prisma.organization.findUnique({ where: { slug: SLUG } });
  const user = await app.prisma.user.findUnique({ where: { email: EMAIL } });
  if (!org || !user) return null;
  return app.prisma.membership.findUnique({ where: { userId_orgId: { userId: user.id, orgId: org.id } } });
}

describe("logowanie przez Hub", () => {
  it("zakłada konto, organizację i członkostwo z rolą z biletu", async () => {
    const res = await loginAs("MEMBER");
    expect(res.statusCode).toBe(302);

    const m = await membership();
    expect(m).not.toBeNull();
    expect(m!.role).toBe("MEMBER");
  });

  it("podnosi rolę, gdy Hub awansował użytkownika", async () => {
    const res = await loginAs("ADMIN");
    expect(res.statusCode).toBe(302);
    expect((await membership())!.role).toBe("ADMIN");
  });

  it("obniża rolę, gdy Hub odebrał uprawnienia", async () => {
    // Kluczowa asercja: bez odświeżania roli odebranie uprawnień w Hubie
    // byłoby pozorne, a użytkownik zachowałby dostęp administracyjny.
    const res = await loginAs("MEMBER");
    expect(res.statusCode).toBe(302);
    expect((await membership())!.role).toBe("MEMBER");
  });

  it("przywraca członkostwo zdezaktywowane lokalnie", async () => {
    const before = await membership();
    await app.prisma.membership.update({ where: { id: before!.id }, data: { disabledAt: new Date() } });

    const res = await loginAs("HR");
    expect(res.statusCode).toBe(302);

    const after = await membership();
    expect(after!.disabledAt).toBeNull();
    expect(after!.role).toBe("HR");
  });

  it("aktualizuje nazwę wyświetlaną z biletu", async () => {
    const res = await loginAs("HR", { name: "Nowa Nazwa" });
    expect(res.statusCode).toBe(302);

    const user = await app.prisma.user.findUnique({ where: { email: EMAIL } });
    expect(user!.displayName).toBe("Nowa Nazwa");
  });

  it("odrzuca bilet z niewłaściwym odbiorcą", async () => {
    const token = await new SignJWT({ typ: "handoff", email: EMAIL, instance_id: INSTANCE })
      .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
      .setIssuer(ISSUER)
      .setAudience("inny-produkt")
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(privateKey);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/sso/callback?token=${encodeURIComponent(token)}`
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("sso_error=invalid");
  });

  it("odrzuca bilet wystawiony dla innej instancji", async () => {
    const res = await loginAs("OWNER", { instance_id: "inna-instancja" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("sso_error=invalid");
    // Rola nie mogła się zmienić na OWNER przez odrzucony bilet.
    expect((await membership())!.role).toBe("HR");
  });
});
