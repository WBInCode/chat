import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// Advanced search filters: from:/in:/has:file/before/after, layered on top
// of (or instead of) the full-text query.

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
let channelId: string;
let ownerMessageId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`search-owner-${uniq}@example.com`, "Owner");
  member = await registerAndLogin(`search-member-${uniq}@example.com`, "Member");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Search Test Org", slug: `search-test-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: member.userId, orgId, role: "MEMBER" } });

  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(owner.token),
    payload: { type: "PUBLIC", name: `search-${uniq}` }
  });
  channelId = channel.json().id;

  const msg = await app.inject({
    method: "POST",
    url: `/api/v1/channels/${channelId}/messages`,
    headers: auth(owner.token),
    payload: { content: "raport kwartalny gotowy" }
  });
  ownerMessageId = msg.json().id;

  await app.inject({
    method: "POST",
    url: `/api/v1/channels/${channelId}/messages`,
    headers: auth(member.token),
    payload: { content: "dzięki, sprawdzę raport" }
  });
});

afterAll(async () => {
  await app.close();
});

describe("search filters", () => {
  it("rejects a query with no text and no filters", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/search?orgId=${orgId}&q=`,
      headers: auth(owner.token)
    });
    expect(res.statusCode).toBe(400);
  });

  it("filters by fromUserId", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/search?orgId=${orgId}&q=raport&fromUserId=${owner.userId}`,
      headers: auth(owner.token)
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().results.map((r: { messageId: string }) => r.messageId);
    expect(ids).toContain(ownerMessageId);
    expect(res.json().results.every((r: { authorId: string }) => r.authorId === owner.userId)).toBe(true);
  });

  it("filters by channelId alone (no text query needed)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/search?orgId=${orgId}&channelId=${channelId}`,
      headers: auth(owner.token)
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results.length).toBeGreaterThanOrEqual(2);
  });

  it("has:file filter returns nothing when no files were attached", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/search?orgId=${orgId}&channelId=${channelId}&hasFile=true`,
      headers: auth(owner.token)
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toHaveLength(0);
  });
});
