import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// Channel-pro features: topic, member management, mute, favorite, group DM.

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
let outsider: Session;
let orgId: string;
let channelId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`chan-owner-${uniq}@example.com`, "Owner");
  member = await registerAndLogin(`chan-member-${uniq}@example.com`, "Member");
  outsider = await registerAndLogin(`chan-outsider-${uniq}@example.com`, "Outsider");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Channel Test Org", slug: `channel-test-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: member.userId, orgId, role: "MEMBER" } });

  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(owner.token),
    payload: { type: "PUBLIC", name: `feature-${uniq}` }
  });
  channelId = channel.json().id;
});

afterAll(async () => {
  await app.close();
});

describe("channel topic", () => {
  it("forbids a plain MEMBER from setting the topic", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}/topic`,
      headers: auth(member.token),
      payload: { topic: "hack" }
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows the channel ADMIN to set the topic", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}/topic`,
      headers: auth(owner.token),
      payload: { topic: "Omawiamy sprint Q3" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().topic).toBe("Omawiamy sprint Q3");
  });
});

describe("mute & favorite (personal, per-user)", () => {
  it("lets a member mute and favorite independently of others", async () => {
    const mute = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}/mute`,
      headers: auth(member.token),
      payload: { muted: true }
    });
    expect(mute.json()).toEqual({ channelId, muted: true });

    const fav = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}/favorite`,
      headers: auth(member.token),
      payload: { favorite: true }
    });
    expect(fav.json()).toEqual({ channelId, favorite: true });

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(member.token)
    });
    const found = list.json().find((c: { id: string }) => c.id === channelId);
    expect(found.muted).toBe(true);
    expect(found.favorite).toBe(true);

    const ownerList = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token)
    });
    const ownerFound = ownerList.json().find((c: { id: string }) => c.id === channelId);
    expect(ownerFound.muted).toBe(false);
    expect(ownerFound.favorite).toBe(false);
  });
});

describe("channel member management", () => {
  it("rejects non-members from viewing the member list (via authz chain)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/channels/${channelId}/members`,
      headers: auth(outsider.token)
    });
    expect(res.statusCode).toBe(404);
  });

  it("lists members for anyone in the channel", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/channels/${channelId}/members`,
      headers: auth(member.token)
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThanOrEqual(2);
  });

  it("forbids a MEMBER from removing another member", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/channels/${channelId}/members/${owner.userId}`,
      headers: auth(member.token)
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows the ADMIN to remove a member", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/channels/${channelId}/members/${member.userId}`,
      headers: auth(owner.token)
    });
    expect(res.statusCode).toBe(204);

    const members = await app.inject({
      method: "GET",
      url: `/api/v1/channels/${channelId}/members`,
      headers: auth(owner.token)
    });
    expect(members.json().find((m: { userId: string }) => m.userId === member.userId)).toBeUndefined();
  });
});

describe("group DM", () => {
  it("requires at least 2 other participants", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/group-dm`,
      headers: auth(owner.token),
      payload: { memberUserIds: [member.userId] }
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates a group DM with 2+ participants", async () => {
    await app.prisma.membership.create({ data: { userId: outsider.userId, orgId, role: "MEMBER" } });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/group-dm`,
      headers: auth(owner.token),
      payload: { memberUserIds: [member.userId, outsider.userId] }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe("DM");

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token)
    });
    const group = list.json().find((c: { id: string }) => c.id === res.json().id);
    expect(group.name).toContain("Member");
    expect(group.name).toContain("Outsider");
  });
});
