import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// F5-I: per-user custom channel ordering in the sidebar (ChannelMember.sortOrder).

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
let outsider: Session;
let orgId: string;
let chanA: string;
let chanB: string;
let chanC: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`reorder-owner-${uniq}@example.com`, "Owner");
  outsider = await registerAndLogin(`reorder-outsider-${uniq}@example.com`, "Outsider");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Reorder Test Org", slug: `reorder-test-${uniq}` }
  });
  orgId = org.json().id;

  for (const name of ["alpha", "beta", "gamma"]) {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token),
      payload: { type: "PUBLIC", name: `${name}-${uniq}` }
    });
    if (name === "alpha") chanA = res.json().id;
    if (name === "beta") chanB = res.json().id;
    if (name === "gamma") chanC = res.json().id;
  }
});

afterAll(async () => {
  await app.close();
});

describe("Channel reordering (F5-I)", () => {
  it("channels default to creation order", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token)
    });
    // Every new org auto-creates a default "general" channel — filter down
    // to just the three test channels for a stable assertion.
    const ids = (res.json() as { id: string }[])
      .map((c) => c.id)
      .filter((id) => [chanA, chanB, chanC].includes(id));
    expect(ids.indexOf(chanA)).toBeLessThan(ids.indexOf(chanB));
    expect(ids.indexOf(chanB)).toBeLessThan(ids.indexOf(chanC));
  });

  it("owner can reorder their own sidebar (gamma, alpha, beta)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/channels/reorder`,
      headers: auth(owner.token),
      payload: { orderedChannelIds: [chanC, chanA, chanB] }
    });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token)
    });
    const ids = (list.json() as { id: string }[])
      .map((c) => c.id)
      .filter((id) => [chanA, chanB, chanC].includes(id));
    expect(ids).toEqual([chanC, chanA, chanB]);
  });

  it("a non-member cannot reorder channels they don't belong to (silently ignored, no crash)", async () => {
    await app.prisma.membership.create({ data: { userId: outsider.userId, orgId, role: "MEMBER" } });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/channels/reorder`,
      headers: auth(outsider.token),
      payload: { orderedChannelIds: [chanA, chanB, chanC] }
    });
    // Outsider isn't a member of any of these channels (PUBLIC channels
    // auto-join at creation time, before the outsider joined the org) —
    // the request succeeds but touches zero rows.
    expect(res.statusCode).toBe(200);
  });

  it("rejects a malformed payload", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/channels/reorder`,
      headers: auth(owner.token),
      payload: { orderedChannelIds: ["not-a-uuid"] }
    });
    expect(res.statusCode).toBe(400);
  });
});
