import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// F5-B: full channel management lifecycle — rename, archive/unarchive,
// browse public channels, self-service join.

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
let publicChannelId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`chanmgmt-owner-${uniq}@example.com`, "Owner");
  member = await registerAndLogin(`chanmgmt-member-${uniq}@example.com`, "Member");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Chan Mgmt Org", slug: `chanmgmt-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: member.userId, orgId, role: "MEMBER" } });

  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(owner.token),
    payload: { type: "PUBLIC", name: `mgmt-${uniq}` }
  });
  publicChannelId = channel.json().id;
});

afterAll(async () => {
  await app.close();
});

describe("channel rename", () => {
  it("forbids a MEMBER from renaming", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${publicChannelId}`,
      headers: auth(member.token),
      payload: { name: `hacked-${uniq}` }
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows the channel ADMIN to rename", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${publicChannelId}`,
      headers: auth(owner.token),
      payload: { name: `renamed-${uniq}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe(`renamed-${uniq}`);
  });
});

describe("archive / unarchive", () => {
  it("forbids a MEMBER from archiving", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${publicChannelId}/archive`,
      headers: auth(member.token)
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows the ADMIN to archive and unarchive", async () => {
    const archive = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${publicChannelId}/archive`,
      headers: auth(owner.token)
    });
    expect(archive.statusCode).toBe(200);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token)
    });
    const found = list.json().find((c: { id: string }) => c.id === publicChannelId);
    expect(found.archivedAt).not.toBeNull();

    const unarchive = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${publicChannelId}/unarchive`,
      headers: auth(owner.token)
    });
    expect(unarchive.statusCode).toBe(200);
  });
});

describe("browse & self-service join", () => {
  it("shows non-member accounts they haven't joined a public channel", async () => {
    const outsider = await registerAndLogin(`chanmgmt-outsider-${uniq}@example.com`, "Outsider");
    await app.prisma.membership.create({ data: { userId: outsider.userId, orgId, role: "MEMBER" } });

    const browse = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/channels/browse`,
      headers: auth(outsider.token)
    });
    expect(browse.statusCode).toBe(200);
    const found = browse.json().find((c: { id: string }) => c.id === publicChannelId);
    // PUBLIC channels auto-add every org member on creation, so outsider (added after) isn't a member yet.
    expect(found.isMember).toBe(false);

    const join = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${publicChannelId}/join`,
      headers: auth(outsider.token)
    });
    expect(join.statusCode).toBe(201);

    const browseAfter = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/channels/browse`,
      headers: auth(outsider.token)
    });
    expect(browseAfter.json().find((c: { id: string }) => c.id === publicChannelId).isMember).toBe(true);
  });

  it("rejects joining a PRIVATE channel via self-service", async () => {
    const priv = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token),
      payload: { type: "PRIVATE", name: `secret-${uniq}` }
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${priv.json().id}/join`,
      headers: auth(member.token)
    });
    expect(res.statusCode).toBe(400);
  });
});
