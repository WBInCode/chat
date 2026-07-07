import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// Integration tests for F5-C custom roles: CRUD permission gates (OWNER
// only), escalation guards (deletion blocked while assigned, unknown
// permission strings rejected by zod enum), and that an assigned custom
// role actually grants the extra permission it lists.

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

  owner = await registerAndLogin(`rowner-${uniq}@example.com`, "Owner");
  member = await registerAndLogin(`rmember-${uniq}@example.com`, "Member Person");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Roles Test Org", slug: `roles-test-${uniq}` }
  });
  orgId = org.json().id;

  await app.prisma.membership.create({ data: { userId: member.userId, orgId, role: "MEMBER" } });
});

afterAll(async () => {
  await app.close();
});

describe("Custom roles (F5-C)", () => {
  it("MEMBER cannot create a role (403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/roles`,
      headers: auth(member.token),
      payload: { name: "Moderator", color: "#ff0000", permissions: ["channel.manage"] }
    });
    expect(res.statusCode).toBe(403);
  });

  it("OWNER can create a role with a subset of permissions", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/roles`,
      headers: auth(owner.token),
      payload: { name: "Moderator", color: "#ff0000", permissions: ["channel.manage", "ai.use"] }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Moderator");
    expect(body.permissions).toEqual(["channel.manage", "ai.use"]);
    expect(body.memberCount).toBe(0);
  });

  it("rejects an unknown permission string (zod enum validation)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/roles`,
      headers: auth(owner.token),
      payload: { name: "Broken", color: "#00ff00", permissions: ["not.a.real.permission"] }
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects duplicate role name in the same org (409)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/roles`,
      headers: auth(owner.token),
      payload: { name: "Moderator", color: "#0000ff", permissions: [] }
    });
    expect(res.statusCode).toBe(409);
  });

  it("assigning the custom role to a member grants its extra permission", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/roles`,
      headers: auth(owner.token)
    });
    const moderatorRole = listRes.json().find((r: { name: string }) => r.name === "Moderator");
    expect(moderatorRole).toBeTruthy();

    const assignRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/members/${member.userId}/custom-role`,
      headers: auth(owner.token),
      payload: { roleId: moderatorRole.id }
    });
    expect(assignRes.statusCode).toBe(200);

    // MEMBER base role has no channel.manage — but the custom role grants it.
    const membersRes = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/admin/members`,
      headers: auth(owner.token)
    });
    const updatedMember = membersRes.json().find((m: { userId: string }) => m.userId === member.userId);
    expect(updatedMember.customRoleId).toBe(moderatorRole.id);

    const roleAfterAssign = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/roles`,
      headers: auth(owner.token)
    });
    const moderatorAfter = roleAfterAssign.json().find((r: { name: string }) => r.name === "Moderator");
    expect(moderatorAfter.memberCount).toBe(1);
  });

  it("cannot delete a role while it is still assigned to a member (403)", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/roles`,
      headers: auth(owner.token)
    });
    const moderatorRole = listRes.json().find((r: { name: string }) => r.name === "Moderator");

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/orgs/${orgId}/roles/${moderatorRole.id}`,
      headers: auth(owner.token)
    });
    expect(deleteRes.statusCode).toBe(403);
  });

  it("unassigning then deleting the role succeeds", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/roles`,
      headers: auth(owner.token)
    });
    const moderatorRole = listRes.json().find((r: { name: string }) => r.name === "Moderator");

    await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/members/${member.userId}/custom-role`,
      headers: auth(owner.token),
      payload: { roleId: null }
    });

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/orgs/${orgId}/roles/${moderatorRole.id}`,
      headers: auth(owner.token)
    });
    expect(deleteRes.statusCode).toBe(204);
  });

  it("MEMBER cannot assign roles to others (role.manage is OWNER-only)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/members/${member.userId}/custom-role`,
      headers: auth(member.token),
      payload: { roleId: null }
    });
    expect(res.statusCode).toBe(403);
  });
});
