import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// Role administratora kanału: nadawanie i odbieranie oraz uprawnienie
// organizacyjne channel.manage jako alternatywa dla roli w kanale.

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

/** Owner organizacji, ale NIE twórca kanału. */
let ownerOrg: Session;
/** Twórca kanału, zwykły MEMBER w organizacji. */
let tworca: Session;
/** Zwykły członek bez żadnych uprawnień. */
let szeregowy: Session;
let orgId: string;
let channelId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  ownerOrg = await registerAndLogin(`rola-owner-${uniq}@example.com`, "Wlasciciel");
  tworca = await registerAndLogin(`rola-tworca-${uniq}@example.com`, "Tworca");
  szeregowy = await registerAndLogin(`rola-szer-${uniq}@example.com`, "Szeregowy");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(ownerOrg.token),
    payload: { name: "Role Org", slug: `role-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: tworca.userId, orgId, role: "MEMBER" } });
  await app.prisma.membership.create({ data: { userId: szeregowy.userId, orgId, role: "MEMBER" } });

  // Kanał zakłada ktoś inny niż właściciel organizacji.
  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(tworca.token),
    payload: { type: "PUBLIC", kind: "ANNOUNCEMENT", name: `ogloszenia-${uniq}` }
  });
  channelId = channel.json().id;
});

afterAll(async () => {
  await app.close();
});

describe("uprawnienie organizacji zamiast roli w kanale", () => {
  it("wlasciciel organizacji zmienia ustawienia cudzego kanalu", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}`,
      headers: auth(ownerOrg.token),
      payload: { topic: "Ustawione przez wlasciciela" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().topic).toBe("Ustawione przez wlasciciela");
  });

  it("szeregowy czlonek nadal nie zmienia ustawien", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}`,
      headers: auth(szeregowy.token),
      payload: { topic: "Podszywka" }
    });
    expect(res.statusCode).toBe(403);
  });

  it("wlasciciel organizacji archiwizuje i przywraca cudzy kanal", async () => {
    const arch = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/archive`,
      headers: auth(ownerOrg.token)
    });
    expect(arch.statusCode).toBe(200);

    const przywroc = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/unarchive`,
      headers: auth(ownerOrg.token)
    });
    expect(przywroc.statusCode).toBe(200);
  });
});

describe("zmiana roli administratora kanalu", () => {
  it("szeregowy czlonek nie moze nadawac rol", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}/members/${szeregowy.userId}`,
      headers: auth(szeregowy.token),
      payload: { role: "ADMIN" }
    });
    expect(res.statusCode).toBe(403);
  });

  it("administrator kanalu nadaje uprawnienia innej osobie", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}/members/${szeregowy.userId}`,
      headers: auth(tworca.token),
      payload: { role: "ADMIN" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("ADMIN");

    const zapis = await app.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: szeregowy.userId } }
    });
    expect(zapis?.role).toBe("ADMIN");
  });

  it("nowy administrator moze pisac w kanale ogloszeniowym", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(szeregowy.token),
      payload: { content: "Ogloszenie od nowego administratora" }
    });
    expect(res.statusCode).toBe(201);
  });

  it("odebranie roli odbiera prawo pisania w kanale ogloszeniowym", async () => {
    const zdejmij = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}/members/${szeregowy.userId}`,
      headers: auth(tworca.token),
      payload: { role: "MEMBER" }
    });
    expect(zdejmij.statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(szeregowy.token),
      payload: { content: "Juz nie powinienem moc" }
    });
    expect(res.statusCode).toBe(403);
  });

  it("nie pozwala zdjac ostatniego administratora", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}/members/${tworca.userId}`,
      headers: auth(tworca.token),
      payload: { role: "MEMBER" }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("LAST_CHANNEL_ADMIN");
  });

  it("wlasciciel organizacji nadaje role na cudzym kanale", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}/members/${szeregowy.userId}`,
      headers: auth(ownerOrg.token),
      payload: { role: "ADMIN" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("ADMIN");
  });

  it("odrzuca osobe spoza kanalu", async () => {
    const obcy = await registerAndLogin(`rola-obcy-${uniq}@example.com`, "Obcy");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}/members/${obcy.userId}`,
      headers: auth(tworca.token),
      payload: { role: "ADMIN" }
    });
    expect(res.statusCode).toBe(404);
  });

  it("rozmowa prywatna nie ma administratorow", async () => {
    const dm = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/dm`,
      headers: auth(tworca.token),
      payload: { targetUserId: szeregowy.userId }
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${dm.json().id}/members/${szeregowy.userId}`,
      headers: auth(tworca.token),
      payload: { role: "ADMIN" }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("DM_IMMUTABLE");
  });
});
