import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// F5-H: platform-level super-admin panel — cross-org user/org management,
// gated entirely by User.isSuperAdmin (independent of any org's role matrix).

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

let superAdmin: Session;
let regularUser: Session;
let orphanUser: Session;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  superAdmin = await registerAndLogin(`super-${uniq}@example.com`, "Super Admin");
  regularUser = await registerAndLogin(`regular-${uniq}@example.com`, "Regular User");
  orphanUser = await registerAndLogin(`orphan-${uniq}@example.com`, "Orphan User");

  await app.prisma.user.update({ where: { id: superAdmin.userId }, data: { isSuperAdmin: true } });
});

afterAll(async () => {
  await app.close();
});

describe("Platform super-admin (F5-H)", () => {
  it("a regular (non-super-admin) user gets 403 from every platform endpoint", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/platform/users", headers: auth(regularUser.token) });
    expect(res.statusCode).toBe(403);
  });

  it("super-admin can list all users, including ones with zero org memberships", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/platform/users", headers: auth(superAdmin.token) });
    expect(res.statusCode).toBe(200);
    const users = res.json() as { id: string; memberships: unknown[] }[];
    const orphan = users.find((u) => u.id === orphanUser.userId);
    expect(orphan).toBeTruthy();
    expect(orphan!.memberships).toEqual([]);
  });

  let orgId: string;

  it("super-admin can create an organization", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/platform/orgs",
      headers: auth(superAdmin.token),
      payload: { name: "Platform Test Org", slug: `platform-test-${uniq}` }
    });
    expect(res.statusCode).toBe(201);
    orgId = res.json().id;
  });

  it("super-admin can assign the orphan user to the org with a role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/platform/memberships",
      headers: auth(superAdmin.token),
      payload: { userId: orphanUser.userId, orgId, role: "MEMBER" }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().role).toBe("MEMBER");

    const usersRes = await app.inject({ method: "GET", url: "/api/v1/platform/users", headers: auth(superAdmin.token) });
    const updated = (usersRes.json() as { id: string; memberships: { orgId: string; role: string }[] }[]).find(
      (u) => u.id === orphanUser.userId
    );
    expect(updated!.memberships).toEqual([{ orgId, orgName: "Platform Test Org", role: "MEMBER", disabled: false }]);
  });

  it("the assigned user can now see the org via the normal /orgs endpoint", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/orgs", headers: auth(orphanUser.token) });
    expect(res.statusCode).toBe(200);
    const orgs = res.json() as { id: string }[];
    expect(orgs.some((o) => o.id === orgId)).toBe(true);
  });

  it("super-admin can remove the membership", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/platform/memberships/${orphanUser.userId}/${orgId}`,
      headers: auth(superAdmin.token)
    });
    expect(res.statusCode).toBe(204);

    const usersRes = await app.inject({ method: "GET", url: "/api/v1/platform/users", headers: auth(superAdmin.token) });
    const updated = (usersRes.json() as { id: string; memberships: unknown[] }[]).find((u) => u.id === orphanUser.userId);
    expect(updated!.memberships).toEqual([]);
  });

  it("a regular user cannot create orgs or assign memberships (403)", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/platform/orgs",
      headers: auth(regularUser.token),
      payload: { name: "Nope", slug: `nope-${uniq}` }
    });
    expect(createRes.statusCode).toBe(403);

    const assignRes = await app.inject({
      method: "POST",
      url: "/api/v1/platform/memberships",
      headers: auth(regularUser.token),
      payload: { userId: orphanUser.userId, orgId, role: "OWNER" }
    });
    expect(assignRes.statusCode).toBe(403);
  });
});
