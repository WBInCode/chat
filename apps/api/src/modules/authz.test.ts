import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// Authorization / IDOR tests: verify the membership chain is enforced
// server-side and that non-members cannot see or touch resources.

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
let privateChannelId: string;
let ownerMessageId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`owner-${uniq}@example.com`, "Owner User");
  outsider = await registerAndLogin(`outsider-${uniq}@example.com`, "Outsider User");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "IDOR Test Org", slug: `idor-${uniq}` }
  });
  orgId = org.json().id;

  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(owner.token),
    payload: { name: "sekretny", type: "PRIVATE" }
  });
  privateChannelId = channel.json().id;

  const msg = await app.inject({
    method: "POST",
    url: `/api/v1/channels/${privateChannelId}/messages`,
    headers: auth(owner.token),
    payload: { content: "Tajna wiadomość zarządu" }
  });
  ownerMessageId = msg.json().id;
});

afterAll(async () => {
  await app.close();
});

describe("Organization isolation", () => {
  it("hides an org from a non-member (404, not 403, to avoid leaking existence)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/members`,
      headers: auth(outsider.token)
    });
    expect(res.statusCode).toBe(404);
  });

  it("forbids a non-member from creating channels in the org", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(outsider.token),
      payload: { name: "wrogi", type: "PUBLIC" }
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Private channel isolation (IDOR)", () => {
  it("prevents a non-member from reading channel history", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/channels/${privateChannelId}/messages`,
      headers: auth(outsider.token)
    });
    expect(res.statusCode).toBe(404);
  });

  it("prevents a non-member from posting to the channel", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${privateChannelId}/messages`,
      headers: auth(outsider.token),
      payload: { content: "Wciskam się tu" }
    });
    expect(res.statusCode).toBe(404);
  });

  it("prevents a non-member from adding themselves as a member", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${privateChannelId}/members`,
      headers: auth(outsider.token),
      payload: { userId: outsider.userId }
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Message ownership", () => {
  it("prevents editing another user's message", async () => {
    // Outsider can't even see it → 404. A member who isn't the author → 403.
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/messages/${ownerMessageId}`,
      headers: auth(outsider.token),
      payload: { content: "Zhakowana treść" }
    });
    expect([403, 404]).toContain(res.statusCode);
  });

  it("prevents deleting another user's message", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/messages/${ownerMessageId}`,
      headers: auth(outsider.token)
    });
    expect([403, 404]).toContain(res.statusCode);
  });

  it("allows the author to edit their own message", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/messages/${ownerMessageId}`,
      headers: auth(owner.token),
      payload: { content: "Poprawiona treść" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().editedAt).not.toBeNull();
  });
});

describe("Search scoping", () => {
  it("does not return messages from channels the user cannot access", async () => {
    // Outsider isn't even a member of the org → 404 on org check.
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/search?orgId=${orgId}&q=Tajna`,
      headers: auth(outsider.token)
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns the owner's own message when they search", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/search?orgId=${orgId}&q=Poprawiona`,
      headers: auth(owner.token)
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results.length).toBeGreaterThanOrEqual(1);
  });
});
