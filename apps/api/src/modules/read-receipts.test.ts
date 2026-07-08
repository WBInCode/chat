import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// F6-C: read receipts — per-member read state endpoint.

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

  owner = await registerAndLogin(`rr-owner-${uniq}@example.com`, "Owner");
  member = await registerAndLogin(`rr-member-${uniq}@example.com`, "Member");
  outsider = await registerAndLogin(`rr-outsider-${uniq}@example.com`, "Outsider");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "RR Org", slug: `rr-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: member.userId, orgId, role: "MEMBER" } });

  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(owner.token),
    payload: { type: "PUBLIC", name: `rr-chan-${uniq}` }
  });
  channelId = channel.json().id;
  // Ensure the member belongs to the channel (idempotent — creating a PUBLIC
  // channel may already auto-join existing org members).
  await app.prisma.channelMember.upsert({
    where: { channelId_userId: { channelId, userId: member.userId } },
    update: {},
    create: { channelId, userId: member.userId, role: "MEMBER" }
  });
});

afterAll(async () => {
  await app.close();
});

describe("read receipts", () => {
  it("returns per-member read state (null before anyone has read)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/channels/${channelId}/read-state`,
      headers: auth(owner.token)
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { userId: string; lastReadAt: string | null }[];
    const ids = body.map((e) => e.userId).sort();
    expect(ids).toEqual([owner.userId, member.userId].sort());
    expect(body.every((e) => e.lastReadAt === null)).toBe(true);
  });

  it("reflects a member's updated lastReadAt", async () => {
    const readAt = new Date("2026-01-01T10:00:00.000Z");
    await app.prisma.channelMember.update({
      where: { channelId_userId: { channelId, userId: member.userId } },
      data: { lastReadAt: readAt }
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/channels/${channelId}/read-state`,
      headers: auth(owner.token)
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { userId: string; lastReadAt: string | null }[];
    const entry = body.find((e) => e.userId === member.userId);
    expect(entry?.lastReadAt).toBe(readAt.toISOString());
  });

  it("rejects a non-member (404)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/channels/${channelId}/read-state`,
      headers: auth(outsider.token)
    });
    expect(res.statusCode).toBe(404);
  });
});
