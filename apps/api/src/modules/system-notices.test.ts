import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { createMessageService } from "./messages/service.js";

// Powiadomienia systemowe: dostarczanie do osobnej rozmowy od nadawcy System,
// brak mozliwosci odpowiedzi oraz kontrola dostepu zrodel.

let app: FastifyInstance;
const uniq = Date.now().toString(36);
const PASSWORD = "BardzoBezpieczneHaslo123";

interface Session {
  token: string;
  userId: string;
  email: string;
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
  return { token: body.accessToken, userId: body.user.id, email };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

let owner: Session;
let czlonek: Session;
let obcy: Session;
let orgId: string;
let token: string;
let sourceId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`pow-owner-${uniq}@example.com`, "Wlasciciel");
  czlonek = await registerAndLogin(`pow-czlonek-${uniq}@example.com`, "Czlonek");
  obcy = await registerAndLogin(`pow-obcy-${uniq}@example.com`, "Obcy");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Powiadomienia Org", slug: `pow-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: czlonek.userId, orgId, role: "MEMBER" } });
});

afterAll(async () => {
  await app.close();
});

describe("zrodla powiadomien", () => {
  it("tworzy zrodlo i pokazuje token dokladnie raz", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/system-notice-sources`,
      headers: auth(owner.token),
      payload: { key: "workbase", label: "WorkBase" }
    });
    expect(res.statusCode).toBe(201);
    token = res.json().token;
    sourceId = res.json().id;
    expect(token).toBeTruthy();

    const lista = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/system-notice-sources`,
      headers: auth(owner.token)
    });
    const zrodlo = (lista.json() as Array<{ id: string; token?: string }>).find((s) => s.id === sourceId);
    expect(zrodlo).toBeTruthy();
    // Token nie moze wracac przy odczycie listy.
    expect(zrodlo?.token).toBeUndefined();
  });

  it("w bazie lezy sam skrot tokenu", async () => {
    const row = await app.prisma.systemNoticeSource.findUnique({ where: { id: sourceId } });
    expect(row?.tokenHash).toBeTruthy();
    expect(row?.tokenHash).not.toBe(token);
  });

  it("zwykly czlonek nie zarzadza zrodlami", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/system-notice-sources`,
      headers: auth(czlonek.token),
      payload: { key: "rytm", label: "Rytm" }
    });
    expect(res.statusCode).toBe(403);
  });

  it("odrzuca duplikat klucza", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/system-notice-sources`,
      headers: auth(owner.token),
      payload: { key: "workbase", label: "Drugi WorkBase" }
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("dostarczanie powiadomien", () => {
  it("odrzuca nieznany token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/system-notices/nieistniejacy-token",
      payload: { recipients: [owner.email], title: "Test" }
    });
    expect(res.statusCode).toBe(404);
  });

  it("dostarcza do osobnej rozmowy od nadawcy System", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/system-notices/${token}`,
      payload: {
        recipients: [czlonek.email],
        title: "Zmiana w grafiku",
        body: "Wtorek 8:00-16:00",
        url: "https://workbase.example/grafik"
      }
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().delivered).toBe(1);

    const kanaly = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(czlonek.token)
    });
    const rozmowa = (kanaly.json() as Array<{ name: string; type: string; readOnly?: boolean }>).find(
      (c) => c.type === "DM" && c.name === "System"
    );
    expect(rozmowa).toBeTruthy();
    expect(rozmowa?.readOnly).toBe(true);
  });

  it("kolejne powiadomienie trafia do tej samej rozmowy", async () => {
    await app.inject({
      method: "POST",
      url: `/api/v1/system-notices/${token}`,
      payload: { recipients: [czlonek.email], title: "Drugie" }
    });

    const bot = await app.prisma.user.findUnique({ where: { email: "system@chatv2.system" } });
    const rozmowy = await app.prisma.channel.findMany({
      where: {
        orgId,
        readOnly: true,
        AND: [
          { members: { some: { userId: czlonek.userId } } },
          { members: { some: { userId: bot!.id } } }
        ]
      }
    });
    expect(rozmowy).toHaveLength(1);
  });

  it("pomija adresy spoza organizacji zamiast odrzucac cala paczke", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/system-notices/${token}`,
      payload: { recipients: [czlonek.email, obcy.email, "nikt@example.com"], title: "Mieszane" }
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().delivered).toBe(1);
    expect(res.json().skipped).toBe(2);
  });

  it("wylaczone zrodlo nie dostarcza", async () => {
    await app.inject({
      method: "PATCH",
      url: `/api/v1/system-notice-sources/${sourceId}`,
      headers: auth(owner.token),
      payload: { enabled: false }
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/system-notices/${token}`,
      payload: { recipients: [czlonek.email], title: "Nie powinno przejsc" }
    });
    expect(res.statusCode).toBe(404);

    await app.inject({
      method: "PATCH",
      url: `/api/v1/system-notice-sources/${sourceId}`,
      headers: auth(owner.token),
      payload: { enabled: true }
    });
  });
});

describe("rozmowa z Systemem jest jednostronna", () => {
  it("nie przyjmuje wiadomosci od czlowieka", async () => {
    const bot = await app.prisma.user.findUnique({ where: { email: "system@chatv2.system" } });
    const rozmowa = await app.prisma.channel.findFirst({
      where: {
        orgId,
        readOnly: true,
        AND: [
          { members: { some: { userId: czlonek.userId } } },
          { members: { some: { userId: bot!.id } } }
        ]
      }
    });
    expect(rozmowa).toBeTruthy();

    const messages = createMessageService(app);
    await expect(messages.sendMessage(czlonek.userId, rozmowa!.id, "czy ktos to czyta?")).rejects.toThrow();
  });

  it("zwykla rozmowa prywatna nadal przyjmuje wiadomosci", async () => {
    const dm = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/dm`,
      headers: auth(owner.token),
      payload: { targetUserId: czlonek.userId }
    });
    const messages = createMessageService(app);
    const wynik = await messages.sendMessage(owner.userId, dm.json().id, "zwykla wiadomosc");
    expect(wynik.content).toBe("zwykla wiadomosc");
  });
});
