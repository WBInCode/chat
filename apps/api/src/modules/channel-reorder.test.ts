import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// Kolejność kanałów jest wspólna dla całej organizacji (Channel.position +
// ChannelCategory.position) i ustawiają ją administratorzy, tak jak w Discordzie.
// Zastąpiło to dawne sortowanie prywatne dla każdego użytkownika.

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

describe("Kolejność kanałów wspólna dla organizacji", () => {
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

  it("owner can reorder the channel list for the whole org (gamma, alpha, beta)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/channel-layout`,
      headers: auth(owner.token),
      payload: {
        categories: [],
        channels: [
          { id: chanC, categoryId: null, position: 0 },
          { id: chanA, categoryId: null, position: 1 },
          { id: chanB, categoryId: null, position: 2 }
        ]
      }
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

  it("the new order is shared — a second member sees exactly the same list", async () => {
    // Kolejność przestała być prywatna: to układ organizacji, nie preferencja
    // pojedynczej osoby. Ten test pilnuje właśnie tej zmiany.
    await app.prisma.membership.create({ data: { userId: outsider.userId, orgId, role: "MEMBER" } });
    for (const channelId of [chanA, chanB, chanC]) {
      await app.prisma.channelMember.create({ data: { channelId, userId: outsider.userId, role: "MEMBER" } });
    }

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(outsider.token)
    });
    const ids = (list.json() as { id: string }[])
      .map((c) => c.id)
      .filter((id) => [chanA, chanB, chanC].includes(id));
    expect(ids).toEqual([chanC, chanA, chanB]);
  });

  it("a plain member cannot change the org-wide order", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/channel-layout`,
      headers: auth(outsider.token),
      payload: {
        categories: [],
        channels: [{ id: chanA, categoryId: null, position: 0 }]
      }
    });
    expect(res.statusCode).toBe(403);

    // Układ musi zostać nietknięty.
    const unchanged = await app.prisma.channel.findUnique({ where: { id: chanA } });
    expect(unchanged!.position).toBe(1);
  });

  it("rejects a malformed payload", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/channel-layout`,
      headers: auth(owner.token),
      payload: { categories: [], channels: [{ id: "not-a-uuid", categoryId: null, position: 0 }] }
    });
    expect(res.statusCode).toBe(400);
  });
});
