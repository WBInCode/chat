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

  async function createPoll(
    token: string,
    payload: Record<string, unknown>
  ): Promise<ReturnType<typeof app.inject>> {
    return app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/polls`,
      headers: auth(token),
      payload
    });
  }

  async function readPoll(messageIdToRead: string, token: string) {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/messages/${messageIdToRead}/poll`,
      headers: auth(token)
    });
    return res.json();
  }

  it("creates a poll message with per-option emoji", async () => {
    const res = await createPoll(owner.token, {
      question: "Kiedy spotkanie?",
      options: [{ text: "Poniedziałek", emoji: "📅" }, { text: "Środa" }],
      allowMultiple: false
    });
    expect(res.statusCode).toBe(201);
    pollMessageId = res.json().messageId;

    const poll = await readPoll(pollMessageId, member.token);
    expect(poll.options).toHaveLength(2);
    expect(poll.options[0].emoji).toBe("📅");
    expect(poll.options[1].emoji).toBeNull();
    expect(poll.closed).toBe(false);
    optionAId = poll.options[0].id;
  });

  it("rejects a deadline in the past", async () => {
    const res = await createPoll(owner.token, {
      question: "Za późno?",
      options: [{ text: "Tak" }, { text: "Nie" }],
      closesAt: new Date(Date.now() - 60_000).toISOString()
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("CLOSES_AT_IN_PAST");
  });

  it("lets members vote, toggle their vote, and enforces single-choice", async () => {
    const poll = await readPoll(pollMessageId, member.token);
    const pollId = poll.id;
    const secondOptionId = poll.options[1].id;

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

  it("counts ballots and people separately when multiple answers are allowed", async () => {
    const created = await createPoll(owner.token, {
      question: "Co zamawiamy?",
      options: [{ text: "Pizza" }, { text: "Sushi" }],
      allowMultiple: true
    });
    const poll = await readPoll(created.json().messageId, member.token);

    for (const option of poll.options) {
      await app.inject({
        method: "POST",
        url: `/api/v1/polls/${poll.id}/vote`,
        headers: auth(member.token),
        payload: { optionId: option.id }
      });
    }

    const after = await readPoll(created.json().messageId, member.token);
    expect(after.totalVotes).toBe(2);
    expect(after.voterCount).toBe(1);
  });

  it("exposes who voted, and reports the viewer's own vote independently", async () => {
    const created = await createPoll(owner.token, {
      question: "Kto dołącza?",
      options: [{ text: "Ja" }, { text: "Nie tym razem" }]
    });
    const poll = await readPoll(created.json().messageId, owner.token);
    const firstOption = poll.options[0].id;

    await app.inject({
      method: "POST",
      url: `/api/v1/polls/${poll.id}/vote`,
      headers: auth(member.token),
      payload: { optionId: firstOption }
    });

    const voters = await app.inject({
      method: "GET",
      url: `/api/v1/polls/${poll.id}/voters`,
      headers: auth(owner.token)
    });
    expect(voters.statusCode).toBe(200);
    const group = voters.json().options.find((o: { optionId: string }) => o.optionId === firstOption);
    expect(group.voters.map((v: { id: string }) => v.id)).toEqual([member.userId]);

    // The owner sees the member's vote but must not be told they voted themselves.
    const asOwner = await readPoll(created.json().messageId, owner.token);
    expect(asOwner.options[0].voterPreview).toHaveLength(1);
    expect(asOwner.options[0].votedByMe).toBe(false);
    const asMember = await readPoll(created.json().messageId, member.token);
    expect(asMember.options[0].votedByMe).toBe(true);
  });

  it("refuses to reveal voters when the poll was created with them hidden", async () => {
    const created = await createPoll(owner.token, {
      question: "Czy podwyżki są sprawiedliwe?",
      options: [{ text: "Tak" }, { text: "Nie" }],
      hideVoters: true
    });
    const poll = await readPoll(created.json().messageId, member.token);

    await app.inject({
      method: "POST",
      url: `/api/v1/polls/${poll.id}/vote`,
      headers: auth(member.token),
      payload: { optionId: poll.options[0].id }
    });

    const after = await readPoll(created.json().messageId, owner.token);
    expect(after.hideVoters).toBe(true);
    expect(after.options[0].votes).toBe(1);
    expect(after.options[0].voterPreview).toEqual([]);

    // Not even the author may look behind the curtain.
    const voters = await app.inject({
      method: "GET",
      url: `/api/v1/polls/${poll.id}/voters`,
      headers: auth(owner.token)
    });
    expect(voters.statusCode).toBe(403);
  });

  it("lets the author close a poll early and then rejects further votes", async () => {
    const created = await createPoll(owner.token, {
      question: "Zamykamy?",
      options: [{ text: "Tak" }, { text: "Nie" }]
    });
    const poll = await readPoll(created.json().messageId, owner.token);
    expect(poll.canClose).toBe(true);

    const asMember = await readPoll(created.json().messageId, member.token);
    expect(asMember.canClose).toBe(false);

    const memberCloses = await app.inject({
      method: "POST",
      url: `/api/v1/polls/${poll.id}/close`,
      headers: auth(member.token)
    });
    expect(memberCloses.statusCode).toBe(403);

    const close = await app.inject({
      method: "POST",
      url: `/api/v1/polls/${poll.id}/close`,
      headers: auth(owner.token)
    });
    expect(close.statusCode).toBe(200);
    expect(close.json().closed).toBe(true);
    expect(close.json().canClose).toBe(false);

    const lateVote = await app.inject({
      method: "POST",
      url: `/api/v1/polls/${poll.id}/vote`,
      headers: auth(member.token),
      payload: { optionId: poll.options[0].id }
    });
    expect(lateVote.statusCode).toBe(409);
    expect(lateVote.json().error.code).toBe("POLL_CLOSED");
  });
});
