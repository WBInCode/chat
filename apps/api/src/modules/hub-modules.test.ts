import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";

// F7-C: Hub → chat module sync via the entitlements webhook. The Hub SSO
// plugin only activates when HUB_* env is set, so we set it before buildApp
// and mock the outbound config fetch.

const uniq = Date.now().toString(36);
const SLUG = `hub-modsync-${uniq}`;
const WEBHOOK_SECRET = "whsecret";

let app: FastifyInstance;
let orgId: string;
let realFetch: typeof globalThis.fetch;
let hubModules: string[] = ["voice", "ai", "files"];
let hubStatus = "active";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.HUB_URL = "http://hub.local";
  process.env.HUB_INSTANCE_ID = "inst-1";
  process.env.HUB_SSO_CLIENT_ID = "chat";
  process.env.HUB_SSO_SECRET = "sekret";
  process.env.HUB_WEBHOOK_SECRET = WEBHOOK_SECRET;

  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/instances/") && url.includes("/config")) {
      return new Response(JSON.stringify({ status: hubStatus, orgSlug: SLUG, modules: hubModules }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof globalThis.fetch;

  const { buildApp } = await import("../app.js");
  app = await buildApp();
  await app.ready();

  const org = await app.prisma.organization.create({ data: { name: "Hub Sync Org", slug: SLUG } });
  orgId = org.id;
});

afterAll(async () => {
  await app.close();
  globalThis.fetch = realFetch;
  delete process.env.HUB_URL;
  delete process.env.HUB_INSTANCE_ID;
  delete process.env.HUB_SSO_CLIENT_ID;
  delete process.env.HUB_SSO_SECRET;
  delete process.env.HUB_WEBHOOK_SECRET;
});

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

async function postWebhook(bodyObj: object, signature?: string) {
  const body = JSON.stringify(bodyObj);
  return app.inject({
    method: "POST",
    url: "/api/v1/sso/webhook",
    headers: {
      "content-type": "application/json",
      "x-wb-event": "entitlements.updated",
      "x-wb-signature": signature ?? sign(body)
    },
    payload: body
  });
}

describe("Hub module sync (F7-C)", () => {
  it("rejects a webhook with an invalid HMAC signature (401)", async () => {
    const res = await postWebhook({ event: "entitlements.updated" }, "sha256=deadbeef");
    expect(res.statusCode).toBe(401);
  });

  it("syncs enabled modules from the Hub config (source=hub)", async () => {
    hubModules = ["voice", "ai", "files"];
    const res = await postWebhook({ event: "entitlements.updated" });
    expect(res.statusCode).toBe(200);

    const rows = await app.prisma.organizationModule.findMany({ where: { orgId } });
    const byKey = new Map(rows.map((r) => [r.moduleKey, r]));
    // Enabled set from the Hub.
    expect(byKey.get("voice")?.enabled).toBe(true);
    expect(byKey.get("ai")?.enabled).toBe(true);
    expect(byKey.get("files")?.enabled).toBe(true);
    // Not in the enabled set → disabled.
    expect(byKey.get("polls")?.enabled).toBe(false);
    expect(byKey.get("search")?.enabled).toBe(false);
    // All marked as hub-sourced.
    expect(rows.every((r) => r.source === "hub")).toBe(true);
  });

  it("reflects a later Hub change (re-enabling a module)", async () => {
    hubModules = ["voice", "ai", "files", "polls", "search"];
    const res = await postWebhook({ event: "entitlements.updated" });
    expect(res.statusCode).toBe(200);

    const polls = await app.prisma.organizationModule.findUnique({
      where: { orgId_moduleKey: { orgId, moduleKey: "polls" } }
    });
    expect(polls?.enabled).toBe(true);
  });

  it("revokes org sessions when the instance becomes suspended", async () => {
    // Seed a user + membership + active session in this org.
    const user = await app.prisma.user.create({
      data: { email: `hubsync-${uniq}@example.com`, displayName: "U", passwordHash: "x" }
    });
    await app.prisma.membership.create({ data: { userId: user.id, orgId, role: "MEMBER" } });
    const session = await app.prisma.session.create({
      data: {
        userId: user.id,
        refreshHash: `rh-${uniq}`,
        familyId: `fam-${uniq}`,
        expiresAt: new Date(Date.now() + 3600_000)
      }
    });

    hubStatus = "suspended";
    const res = await postWebhook({ event: "entitlements.updated" });
    expect(res.statusCode).toBe(200);
    hubStatus = "active";

    const after = await app.prisma.session.findUnique({ where: { id: session.id } });
    expect(after?.revokedAt).not.toBeNull();
  });
});
