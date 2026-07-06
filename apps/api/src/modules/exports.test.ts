import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// GDPR data-export endpoints: self-service export creation/polling, and
// admin-initiated export scoped to a single org+member (OWNER-only).

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

let owner: Session;
let member: Session;
let orgId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`exp-owner-${uniq}@example.com`, "Owner");
  member = await registerAndLogin(`exp-member-${uniq}@example.com`, "Member");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Export Test Org", slug: `export-test-${uniq}` }
  });
  orgId = org.json().id;

  await app.prisma.membership.create({ data: { userId: member.userId, orgId, role: "MEMBER" } });
});

afterAll(async () => {
  await app.close();
});

describe("self-service data export", () => {
  it("creates a pending export and allows the owner to poll it", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/me/export",
      headers: auth(member.token)
    });
    expect(create.statusCode).toBe(200);
    const body = create.json();
    expect(body.status).toBe("PENDING");
    expect(body.downloadUrl).toBeNull();

    const poll = await app.inject({
      method: "GET",
      url: `/api/v1/me/exports/${body.id}`,
      headers: auth(member.token)
    });
    expect(poll.statusCode).toBe(200);
    expect(poll.json().id).toBe(body.id);
  });

  it("returns 404 when polling another user's export (IDOR check)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/me/export",
      headers: auth(owner.token)
    });
    const exportId = create.json().id;

    const poll = await app.inject({
      method: "GET",
      url: `/api/v1/me/exports/${exportId}`,
      headers: auth(member.token)
    });
    expect(poll.statusCode).toBe(404);
  });
});

describe("admin-initiated member export", () => {
  it("allows OWNER to request an export for a member", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/admin/members/${member.userId}/export`,
      headers: auth(owner.token)
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("PENDING");
  });

  it("forbids a MEMBER from requesting another member's export", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/admin/members/${owner.userId}/export`,
      headers: auth(member.token)
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("account deletion", () => {
  it("anonymizes the account and blocks further logins", async () => {
    const del = await app.inject({
      method: "DELETE",
      url: "/api/v1/me",
      headers: auth(member.token),
      payload: { confirm: true }
    });
    expect(del.statusCode).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: `exp-member-${uniq}@example.com`, password: PASSWORD }
    });
    expect(login.statusCode).toBe(401);
  });
});
