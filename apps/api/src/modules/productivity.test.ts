import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// F4-E: scheduled sends, reminders, polls.

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
let messageId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`prod-owner-${uniq}@example.com`, "Owner");
  member = await registerAndLogin(`prod-member-${uniq}@example.com`, "Member");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Productivity Test Org", slug: `prod-test-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: member.userId, orgId, role: "MEMBER" } });

  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(owner.token),
    payload: { type: "PUBLIC", name: `prod-${uniq}` }
  });
  channelId = channel.json().id;

  const msg = await app.inject({
    method: "POST",
    url: `/api/v1/channels/${channelId}/messages`,
    headers: auth(owner.token),
    payload: { content: "wiadomość do przypomnienia" }
  });
  messageId = msg.json().id;
});

afterAll(async () => {
  await app.close();
});

describe("scheduled messages", () => {
  it("rejects a send time in the past", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/schedule`,
      headers: auth(owner.token),
      payload: { content: "za późno", sendAt: new Date(Date.now() - 60_000).toISOString() }
    });
    expect(res.statusCode).toBe(400);
  });

  it("schedules and lists a future message, then allows cancelling it", async () => {
    const sendAt = new Date(Date.now() + 3600_000).toISOString();
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/schedule`,
      headers: auth(owner.token),
      payload: { content: "wyślij później", sendAt }
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/channels/${channelId}/scheduled`,
      headers: auth(owner.token)
    });
    expect(list.json().some((s: { id: string }) => s.id === id)).toBe(true);

    const cancel = await app.inject({
      method: "DELETE",
      url: `/api/v1/scheduled-messages/${id}`,
      headers: auth(owner.token)
    });
    expect(cancel.statusCode).toBe(204);
  });
});

describe("reminders", () => {
  it("rejects a remind time in the past", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reminders",
      headers: auth(owner.token),
      payload: { messageId, remindAt: new Date(Date.now() - 60_000).toISOString() }
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates, lists and deletes a reminder", async () => {
    const remindAt = new Date(Date.now() + 3600_000).toISOString();
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/reminders",
      headers: auth(owner.token),
      payload: { messageId, remindAt, note: "sprawdź to" }
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/me/reminders",
      headers: auth(owner.token)
    });
    expect(list.json().some((r: { id: string }) => r.id === id)).toBe(true);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/reminders/${id}`,
      headers: auth(owner.token)
    });
    expect(del.statusCode).toBe(204);
  });
});

describe("polls", () => {
  let pollMessageId: string;
  let optionAId: string;

  it("creates a poll message", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/polls`,
      headers: auth(owner.token),
      payload: { question: "Kiedy spotkanie?", options: ["Poniedziałek", "Środa"], allowMultiple: false }
    });
    expect(res.statusCode).toBe(201);
    pollMessageId = res.json().messageId;

    const poll = await app.inject({
      method: "GET",
      url: `/api/v1/messages/${pollMessageId}/poll`,
      headers: auth(member.token)
    });
    expect(poll.statusCode).toBe(200);
    expect(poll.json().options).toHaveLength(2);
    optionAId = poll.json().options[0].id;
  });

  it("lets members vote, toggle their vote, and enforces single-choice", async () => {
    const pollRes = await app.inject({
      method: "GET",
      url: `/api/v1/messages/${pollMessageId}/poll`,
      headers: auth(member.token)
    });
    const pollId = pollRes.json().id;
    const secondOptionId = pollRes.json().options[1].id;

    const vote1 = await app.inject({
      method: "POST",
      url: `/api/v1/polls/${pollId}/vote`,
      headers: auth(member.token),
      payload: { optionId: optionAId }
    });
    expect(vote1.json().options.find((o: { id: string }) => o.id === optionAId).votes).toBe(1);

    // Voting for the second option in a single-choice poll should move the vote, not add a second one.
    const vote2 = await app.inject({
      method: "POST",
      url: `/api/v1/polls/${pollId}/vote`,
      headers: auth(member.token),
      payload: { optionId: secondOptionId }
    });
    expect(vote2.json().totalVotes).toBe(1);
    expect(vote2.json().options.find((o: { id: string }) => o.id === optionAId).votes).toBe(0);

    // Voting the same option again removes it (toggle).
    const vote3 = await app.inject({
      method: "POST",
      url: `/api/v1/polls/${pollId}/vote`,
      headers: auth(member.token),
      payload: { optionId: secondOptionId }
    });
    expect(vote3.json().totalVotes).toBe(0);
  });
});
