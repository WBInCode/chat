import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { env } from "../config/env.js";

// F5-D: AI assistant — feature flag, permission/membership gates, quota
// enforcement, and the "@AI" in-channel bot. All provider HTTP calls are
// mocked (global.fetch) so these tests never hit the real Groq/Gemini APIs
// and never consume the real free-tier daily budget.

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

function mockGroqOnce(replyText: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: replyText } }] })
    })
  );
}

let owner: Session;
let outsider: Session;
let orgId: string;
let channelId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`aiowner-${uniq}@example.com`, "Owner");
  outsider = await registerAndLogin(`aioutsider-${uniq}@example.com`, "Outsider");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "AI Test Org", slug: `ai-test-${uniq}` }
  });
  orgId = org.json().id;

  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(owner.token),
    payload: { name: "ai-general", type: "PUBLIC" }
  });
  channelId = channel.json().id;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await app.close();
});

describe("AI assistant (F5-D)", () => {
  it("GET /ai/status reflects isAiEnabled() (a provider key is configured in this dev env)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/ai/status", headers: auth(owner.token) });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().enabled).toBe("boolean");
  });

  it("a non-member cannot summarize a channel they don't belong to (404)", async () => {
    mockGroqOnce("- punkt 1\n- punkt 2");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/ai/summarize`,
      headers: auth(outsider.token)
    });
    expect(res.statusCode).toBe(404);
  });

  it("a channel member can summarize (mocked provider response)", async () => {
    await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(owner.token),
      payload: { content: "Umówmy się na spotkanie jutro o 10." }
    });

    mockGroqOnce("- Ustalono termin spotkania\n- Zadanie do zrobienia: raport");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/ai/summarize`,
      headers: auth(owner.token)
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toContain("Ustalono");
  });

  it("rewrite requires an orgId query param (404 without it)", async () => {
    mockGroqOnce("poprawiony tekst");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/rewrite",
      headers: auth(owner.token),
      payload: { text: "tekst do poprawy", mode: "improve" }
    });
    expect(res.statusCode).toBe(404);
  });

  it("rewrite returns the provider's response for an authorized org member", async () => {
    mockGroqOnce("Poprawiony i elegancki tekst.");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/ai/rewrite?orgId=${orgId}`,
      headers: auth(owner.token),
      payload: { text: "tekst do poprawy", mode: "improve" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toBe("Poprawiony i elegancki tekst.");
  });

  it("supports the 'corpo' rewrite mode (corporate buzzword translator)", async () => {
    mockGroqOnce("Zdecydowanie leveragujemy synergie na poziomie wysokim, action items TBD EOD.");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/ai/rewrite?orgId=${orgId}`,
      headers: auth(owner.token),
      payload: { text: "zróbmy to jutro", mode: "corpo" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toContain("synergie");
  });

  it("supports the 'corpo_hard' rewrite mode (over-the-top corpo satire)", async () => {
    mockGroqOnce("Czy moglibyśmy zsynchronizować deep dive w temacie touchpointu?");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/ai/rewrite?orgId=${orgId}`,
      headers: auth(owner.token),
      payload: { text: "kiedy będzie wypłata?", mode: "corpo_hard" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toContain("touchpointu");
  });

  it("rejects an unknown rewrite mode (zod validation)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/ai/rewrite?orgId=${orgId}`,
      headers: auth(owner.token),
      payload: { text: "tekst", mode: "not-a-real-mode" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("enforces the daily free-tier quota (429 once the budget is exhausted)", async () => {
    const originalLimit = env.AI_DAILY_LIMIT;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env as any).AI_DAILY_LIMIT = 0;
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/ai/rewrite?orgId=${orgId}`,
        headers: auth(owner.token),
        payload: { text: "tekst", mode: "improve" }
      });
      expect(res.statusCode).toBe(429);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (env as any).AI_DAILY_LIMIT = originalLimit;
    }
  });

  it("sending a message that mentions @AI triggers a bot reply visible in the thread", async () => {
    mockGroqOnce("Cześć! W czym mogę pomóc?");

    const send = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(owner.token),
      payload: { content: "@AI podsumuj proszę" }
    });
    expect(send.statusCode).toBe(201);
    const triggerMessageId = send.json().id;

    // The bot reply is fire-and-forget and lands as a thread reply on the
    // triggering message — poll briefly for it to appear.
    let botMessage: { content: string } | undefined;
    for (let i = 0; i < 20 && !botMessage; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const thread = await app.inject({
        method: "GET",
        url: `/api/v1/messages/${triggerMessageId}/thread`,
        headers: auth(owner.token)
      });
      const replies = (thread.json().replies ?? []) as { content: string }[];
      botMessage = replies.find((m) => m.content === "Cześć! W czym mogę pomóc?");
    }
    expect(botMessage).toBeTruthy();
  });
});
