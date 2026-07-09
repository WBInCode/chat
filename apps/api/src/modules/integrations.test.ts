import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// F7-I: incoming integration webhooks (CI/monitoring -> channel), gated by
// the `integrations` module.

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
let channelId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`int-owner-${uniq}@example.com`, "Owner");
  member = await registerAndLogin(`int-member-${uniq}@example.com`, "Member");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Integrations Org", slug: `int-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: member.userId, orgId, role: "MEMBER" } });

  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(owner.token),
    payload: { type: "PUBLIC", name: `int-${uniq}` }
  });
  channelId = channel.json().id;
});

afterAll(async () => {
  await app.close();
});

describe("integration webhooks (F7-I)", () => {
  it("forbids a MEMBER from creating a webhook", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/integrations`,
      headers: auth(member.token),
      payload: { channelId, name: "CI" }
    });
    expect(res.statusCode).toBe(403);
  });

  it("owner creates a webhook and receives the plaintext token exactly once", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/integrations`,
      headers: auth(owner.token),
      payload: { channelId, name: "CI Pipeline" }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toBeTruthy();
    expect(body.enabled).toBe(true);
    expect(body.messageCount).toBe(0);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/integrations`,
      headers: auth(owner.token)
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()[0].token).toBeUndefined(); // never re-exposed
  });

  it("posts a message into the channel via the public token endpoint", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/integrations`,
      headers: auth(owner.token),
      payload: { channelId, name: "Monitoring" }
    });
    const { id, token } = created.json();

    const hook = await app.inject({
      method: "POST",
      url: `/api/v1/webhooks/incoming/${token}`,
      payload: { text: "🔴 Build failed on main", username: "CI" }
    });
    expect(hook.statusCode).toBe(202);

    const messages = await app.inject({
      method: "GET",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(owner.token)
    });
    const posted = messages.json().messages.find((m: { content: string }) =>
      m.content.includes("Build failed on main")
    );
    expect(posted).toBeTruthy();

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/integrations`,
      headers: auth(owner.token)
    });
    const dto = list.json().find((w: { id: string }) => w.id === id);
    expect(dto.messageCount).toBe(1);
    expect(dto.lastUsedAt).toBeTruthy();
  });

  it("rejects an invalid token with 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/incoming/not-a-real-token",
      payload: { text: "hello" }
    });
    expect(res.statusCode).toBe(404);
  });

  it("disabling a webhook makes the public endpoint reject further posts", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/integrations`,
      headers: auth(owner.token),
      payload: { channelId, name: "Toggle Test" }
    });
    const { id, token } = created.json();

    const off = await app.inject({
      method: "PATCH",
      url: `/api/v1/integrations/${id}`,
      headers: auth(owner.token),
      payload: { enabled: false }
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().enabled).toBe(false);

    const hook = await app.inject({
      method: "POST",
      url: `/api/v1/webhooks/incoming/${token}`,
      payload: { text: "should not land" }
    });
    expect(hook.statusCode).toBe(404);
  });

  it("gates webhook creation behind the integrations module toggle", async () => {
    const off = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/modules`,
      headers: auth(owner.token),
      payload: { key: "integrations", enabled: false }
    });
    expect(off.statusCode).toBe(200);

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/integrations`,
      headers: auth(owner.token),
      payload: { channelId, name: "Gated" }
    });
    expect(created.statusCode).toBe(403);
    expect(created.json().error.code).toBe("MODULE_DISABLED");

    // Restore for downstream test files that might reuse this org (isolation).
    await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/modules`,
      headers: auth(owner.token),
      payload: { key: "integrations", enabled: true }
    });
  });

  it("deletes a webhook", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/integrations`,
      headers: auth(owner.token),
      payload: { channelId, name: "To Delete" }
    });
    const { id } = created.json();

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/integrations/${id}`,
      headers: auth(owner.token)
    });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/integrations`,
      headers: auth(owner.token)
    });
    expect(list.json().find((w: { id: string }) => w.id === id)).toBeUndefined();
  });
});
