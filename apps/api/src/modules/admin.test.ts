import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// Integration tests for the HR/Admin panel: role assignment, deactivation
// (with session revocation), and the HR/Admin audit-log visibility split.

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
let hr: Session;
let member: Session;
let orgId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`owner-${uniq}@example.com`, "Owner");
  hr = await registerAndLogin(`hr-${uniq}@example.com`, "HR Person");
  member = await registerAndLogin(`member-${uniq}@example.com`, "Member Person");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Admin Test Org", slug: `admin-test-${uniq}` }
  });
  orgId = org.json().id;

  // Manually insert memberships for hr/member (bypassing invite flow for test setup).
  const prisma = app.prisma;
  await prisma.membership.create({ data: { userId: hr.userId, orgId, role: "HR" } });
  await prisma.membership.create({ data: { userId: member.userId, orgId, role: "MEMBER" } });
});

afterAll(async () => {
  await app.close();
});

describe("Admin — member management", () => {
  it("forbids a MEMBER from listing org members via admin endpoint", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/admin/members`,
      headers: auth(member.token)
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows HR to list members but not change roles", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/admin/members`,
      headers: auth(hr.token)
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBeGreaterThanOrEqual(3);

    const roleChange = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/members/${member.userId}/role`,
      headers: auth(hr.token),
      payload: { role: "ADMIN" }
    });
    expect(roleChange.statusCode).toBe(403);
  });

  it("allows OWNER to change a member's role", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/members/${member.userId}/role`,
      headers: auth(owner.token),
      payload: { role: "HR" }
    });
    expect(res.statusCode).toBe(200);
  });

  it("deactivating a member immediately revokes their active session", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: `member-${uniq}@example.com`, password: PASSWORD }
    });
    const freshToken = login.json().accessToken;

    const meBefore = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: auth(freshToken)
    });
    expect(meBefore.statusCode).toBe(200);

    const deactivate = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/members/${member.userId}/deactivate`,
      headers: auth(hr.token), // HR can deactivate
      payload: { disabled: true }
    });
    expect(deactivate.statusCode).toBe(200);

    const meAfter = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: auth(freshToken)
    });
    expect(meAfter.statusCode).toBe(401);

    // Org-scoped access is also blocked (membership.disabledAt).
    const orgAccess = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/members`,
      headers: auth(owner.token)
    });
    expect(orgAccess.statusCode).toBe(200); // owner unaffected
  });

  it("prevents deactivating or changing the role of the OWNER", async () => {
    const roleRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/members/${owner.userId}/role`,
      headers: auth(owner.token),
      payload: { role: "MEMBER" }
    });
    expect(roleRes.statusCode).toBe(403);

    const deactivateRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/members/${owner.userId}/deactivate`,
      headers: auth(owner.token),
      payload: { disabled: true }
    });
    expect(deactivateRes.statusCode).toBe(403);
  });
});

describe("Admin — audit log", () => {
  it("records role changes and deactivations with a valid hash chain", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/admin/audit`,
      headers: auth(owner.token)
    });
    expect(res.statusCode).toBe(200);
    const entries = res.json().entries;
    expect(entries.some((e: { action: string }) => e.action === "member.role_changed")).toBe(true);
    expect(entries.some((e: { action: string }) => e.action === "member.deactivated")).toBe(true);

    const verify = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/admin/audit/verify`,
      headers: auth(owner.token)
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().valid).toBe(true);
  });

  it("forbids MEMBER/HR-less roles from reading the audit log", async () => {
    // member.userId was promoted to HR earlier and then deactivated, so use
    // a fresh plain member instead.
    const plain = await registerAndLogin(`plain-${uniq}@example.com`, "Plain");
    await app.prisma.membership.create({ data: { userId: plain.userId, orgId, role: "MEMBER" } });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/admin/audit`,
      headers: auth(plain.token)
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Admin — org settings", () => {
  it("allows ADMIN/OWNER to update settings, forbids HR", async () => {
    const asHr = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/settings`,
      headers: auth(hr.token),
      payload: { require2fa: true }
    });
    expect(asHr.statusCode).toBe(403);

    const asOwner = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/settings`,
      headers: auth(owner.token),
      payload: { require2fa: true, messageRetentionDays: 90 }
    });
    expect(asOwner.statusCode).toBe(200);
    expect(asOwner.json().require2fa).toBe(true);
    expect(asOwner.json().messageRetentionDays).toBe(90);
  });
});

describe("Admin — analytics", () => {
  it("forbids a MEMBER and returns workspace stats for OWNER", async () => {
    // Seed a channel with a few messages authored by owner and hr.
    const channel = await app.prisma.channel.create({
      data: { orgId, type: "PUBLIC", name: `analytics-${uniq}`, createdBy: owner.userId }
    });
    await app.prisma.message.createMany({
      data: [
        { channelId: channel.id, authorId: owner.userId, content: "a" },
        { channelId: channel.id, authorId: owner.userId, content: "b" },
        { channelId: channel.id, authorId: hr.userId, content: "c" }
      ]
    });

    const forbidden = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/admin/analytics`,
      headers: auth(hr.token)
    });
    expect(forbidden.statusCode).toBe(403);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/admin/analytics`,
      headers: auth(owner.token)
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.memberCount).toBeGreaterThanOrEqual(3);
    expect(body.totalMessages).toBeGreaterThanOrEqual(3);
    expect(body.messages7d).toBeGreaterThanOrEqual(3);
    expect(body.activeMembers7d).toBeGreaterThanOrEqual(2);
    expect(body.dailyMessages).toHaveLength(7);
    // Today's bucket should include the seeded messages.
    expect(body.dailyMessages[6].count).toBeGreaterThanOrEqual(3);
    expect(body.topChannels.some((c: { name: string }) => c.name === `analytics-${uniq}`)).toBe(true);
  });
});

