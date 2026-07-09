import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// F7-A: per-organization module toggles + gating.

let app: FastifyInstance;
const uniq = Date.now().toString(36);
const PASSWORD = "BardzoBezpieczneHaslo123";

interface Session {
  token: string;
  userId: string;
}

async function registerAndLogin(email: string, displayName: string): Promise<Session> {
  await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email, password: PASSWORD, displayName } });
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASSWORD } });
  const body = login.json();
  return { token: body.accessToken, userId: body.user.id };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

let owner: Session;
let member: Session;
let orgId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`mod-owner-${uniq}@example.com`, "Owner");
  member = await registerAndLogin(`mod-member-${uniq}@example.com`, "Member");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Modules Org", slug: `mod-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: member.userId, orgId, role: "MEMBER" } });
});

afterAll(async () => {
  await app.close();
});

describe("module toggles (F7-A)", () => {
  it("returns all modules enabled by default", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/orgs/${orgId}/modules`, headers: auth(member.token) });
    expect(res.statusCode).toBe(200);
    const state = res.json();
    expect(state.messaging).toBe(true);
    expect(state.search).toBe(true);
    expect(state.voice).toBe(true);
  });

  it("forbids a MEMBER from toggling modules", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/modules`,
      headers: auth(member.token),
      payload: { key: "search", enabled: false }
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects toggling a core module (zod enum)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/modules`,
      headers: auth(owner.token),
      payload: { key: "messaging", enabled: false }
    });
    expect(res.statusCode).toBe(400);
  });

  it("disabling the search module gates the search endpoint (403 MODULE_DISABLED)", async () => {
    const off = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/modules`,
      headers: auth(owner.token),
      payload: { key: "search", enabled: false }
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().search).toBe(false);

    const search = await app.inject({
      method: "GET",
      url: `/api/v1/search?orgId=${orgId}&q=hello`,
      headers: auth(member.token)
    });
    expect(search.statusCode).toBe(403);
    expect(search.json().error.code).toBe("MODULE_DISABLED");

    // Re-enable and confirm the endpoint works again.
    const on = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/modules`,
      headers: auth(owner.token),
      payload: { key: "search", enabled: true }
    });
    expect(on.json().search).toBe(true);

    const search2 = await app.inject({
      method: "GET",
      url: `/api/v1/search?orgId=${orgId}&q=hello`,
      headers: auth(member.token)
    });
    expect(search2.statusCode).toBe(200);
  });

  it("exposes the module catalog", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/modules/catalog", headers: auth(member.token) });
    expect(res.statusCode).toBe(200);
    const catalog = res.json() as { key: string; core: boolean }[];
    expect(catalog.find((m) => m.key === "messaging")?.core).toBe(true);
    expect(catalog.find((m) => m.key === "voice")?.core).toBe(false);
  });

  it("admin module view returns per-module state + source", async () => {
    // Disable one to assert source flips to "local".
    await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/modules`,
      headers: auth(owner.token),
      payload: { key: "polls", enabled: false }
    });

    const forbidden = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/admin/modules`,
      headers: auth(member.token)
    });
    expect(forbidden.statusCode).toBe(403);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/admin/modules`,
      headers: auth(owner.token)
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { key: string; core: boolean; enabled: boolean; source: string }[];
    expect(rows).toHaveLength(15);
    const messaging = rows.find((r) => r.key === "messaging");
    expect(messaging?.core).toBe(true);
    expect(messaging?.source).toBe("core");
    const polls = rows.find((r) => r.key === "polls");
    expect(polls?.enabled).toBe(false);
    expect(polls?.source).toBe("local");
    const voice = rows.find((r) => r.key === "voice");
    expect(voice?.enabled).toBe(true);
    expect(voice?.source).toBe("default");
  });
});
