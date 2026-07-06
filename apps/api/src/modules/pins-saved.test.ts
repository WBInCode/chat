import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// Message pinning (channel-ADMIN only) and personal saved-messages
// bookmarks (any channel member).

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
let channelId: string;
let messageId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`pin-owner-${uniq}@example.com`, "Owner");
  member = await registerAndLogin(`pin-member-${uniq}@example.com`, "Member");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Pin Test Org", slug: `pin-test-${uniq}` }
  });
  const orgId = org.json().id;

  await app.prisma.membership.create({ data: { userId: member.userId, orgId, role: "MEMBER" } });

  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(owner.token),
    payload: { type: "PUBLIC", name: `general-${uniq}` }
  });
  channelId = channel.json().id;

  const msg = await app.inject({
    method: "POST",
    url: `/api/v1/channels/${channelId}/messages`,
    headers: auth(owner.token),
    payload: { content: "Wiadomość do przypięcia" }
  });
  messageId = msg.json().id;
});

afterAll(async () => {
  await app.close();
});

describe("message pinning", () => {
  it("forbids a plain MEMBER from pinning", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/messages/${messageId}/pin`,
      headers: auth(member.token)
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows the channel ADMIN (creator) to pin and unpin", async () => {
    const pin = await app.inject({
      method: "POST",
      url: `/api/v1/messages/${messageId}/pin`,
      headers: auth(owner.token)
    });
    expect(pin.statusCode).toBe(200);
    expect(pin.json().pinnedAt).not.toBeNull();

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/channels/${channelId}/pinned`,
      headers: auth(member.token)
    });
    expect(list.json()).toHaveLength(1);

    const unpin = await app.inject({
      method: "DELETE",
      url: `/api/v1/messages/${messageId}/pin`,
      headers: auth(owner.token)
    });
    expect(unpin.json().pinnedAt).toBeNull();
  });
});

describe("saved messages (personal bookmarks)", () => {
  it("lets any channel member toggle-save a message and list their saves", async () => {
    const save = await app.inject({
      method: "POST",
      url: `/api/v1/messages/${messageId}/save`,
      headers: auth(member.token)
    });
    expect(save.json()).toEqual({ messageId, saved: true });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/me/saved-messages",
      headers: auth(member.token)
    });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].message.id).toBe(messageId);

    const unsave = await app.inject({
      method: "POST",
      url: `/api/v1/messages/${messageId}/save`,
      headers: auth(member.token)
    });
    expect(unsave.json()).toEqual({ messageId, saved: false });
  });

  it("keeps saves private per user", async () => {
    await app.inject({
      method: "POST",
      url: `/api/v1/messages/${messageId}/save`,
      headers: auth(owner.token)
    });
    const memberList = await app.inject({
      method: "GET",
      url: "/api/v1/me/saved-messages",
      headers: auth(member.token)
    });
    expect(memberList.json()).toHaveLength(0);
  });
});
