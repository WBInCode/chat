import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// Usunieta wiadomosc ma zostawiac sam slad w historii - bez zalacznikow,
// podgladow linkow i reakcji, ktorych nie dalo by sie juz usunac.

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
let reader: Session;
let orgId: string;
let channelId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`del-owner-${uniq}@example.com`, "Autor");
  reader = await registerAndLogin(`del-reader-${uniq}@example.com`, "Czytelnik");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Delete Test Org", slug: `del-test-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: reader.userId, orgId, role: "MEMBER" } });

  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(owner.token),
    payload: { type: "PUBLIC", name: `del-${uniq}` }
  });
  channelId = channel.json().id;
  await app.prisma.channelMember.upsert({
    where: { channelId_userId: { channelId, userId: reader.userId } },
    update: {},
    create: { channelId, userId: reader.userId, role: "MEMBER" }
  });
});

afterAll(async () => {
  await app.close();
});

async function listMessages(token: string) {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/channels/${channelId}/messages`,
    headers: auth(token)
  });
  return res.json().messages as Array<Record<string, unknown>>;
}

describe("usuwanie wiadomosci", () => {
  it("po usunieciu nie zostaje ani tresc, ani podglad linku", async () => {
    const sent = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(owner.token),
      payload: { content: "Zobacz https://example.com/tajny-raport" }
    });
    const messageId = sent.json().id;

    // Worker unfurl dziala w tle; wstawiamy podglad wprost, zeby test byl
    // deterministyczny i nie zalezal od sieci.
    await app.prisma.linkEmbed.create({
      data: {
        messageId,
        url: "https://example.com/tajny-raport",
        title: "Tajny raport",
        description: "Opis, ktory nie moze przetrwac usuniecia"
      }
    });

    const beforeDelete = (await listMessages(reader.token)).find((m) => m.id === messageId)!;
    expect(beforeDelete.embeds).toBeDefined();

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/messages/${messageId}`,
      headers: auth(owner.token)
    });
    expect(del.statusCode).toBe(204);

    // Odswiezenie listy = to samo, co przeladowanie strony przez uzytkownika.
    const after = (await listMessages(reader.token)).find((m) => m.id === messageId)!;
    expect(after).toBeDefined();
    expect(after.content).toBe("");
    expect(after.embeds).toBeUndefined();
    expect(after.reactions).toBeUndefined();
    expect(after.files).toBeUndefined();

    // Wiersz podgladu ma zniknac z bazy, a nie tylko z odpowiedzi.
    const embedsLeft = await app.prisma.linkEmbed.count({ where: { messageId } });
    expect(embedsLeft).toBe(0);
  });

  it("zalacznik usunietej wiadomosci przestaje byc pobieralny", async () => {
    const sent = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(owner.token),
      payload: { content: "Wiadomosc z plikiem" }
    });
    const messageId = sent.json().id;

    // Plik tworzymy wprost w bazie: test sprawdza regule dostepu, a nie
    // sciezke wysylki do magazynu obiektow.
    const file = await app.prisma.file.create({
      data: {
        orgId,
        channelId,
        messageId,
        uploaderId: owner.userId,
        name: "poufne.pdf",
        mimeType: "application/pdf",
        size: 1024,
        key: `test/${uniq}-poufne.pdf`,
        status: "CLEAN"
      }
    });

    const beforeDelete = await app.inject({
      method: "GET",
      url: `/api/v1/files/${file.id}/url`,
      headers: auth(reader.token)
    });
    expect(beforeDelete.statusCode).toBe(200);

    await app.inject({
      method: "DELETE",
      url: `/api/v1/messages/${messageId}`,
      headers: auth(owner.token)
    });

    // Kluczowa asercja: po usunieciu wiadomosci plik jest nieosiagalny.
    const afterDelete = await app.inject({
      method: "GET",
      url: `/api/v1/files/${file.id}/url`,
      headers: auth(reader.token)
    });
    expect(afterDelete.statusCode).toBe(404);

    // I nie wisi juz w liscie wiadomosci.
    const after = (await listMessages(reader.token)).find((m) => m.id === messageId)!;
    expect(after.files).toBeUndefined();
  });

  it("odmawia pobrania takze wtedy, gdy wiersz pliku przetrwal usuwanie", async () => {
    const sent = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(owner.token),
      payload: { content: "Wiadomosc z osieroconym plikiem" }
    });
    const messageId = sent.json().id;

    const file = await app.prisma.file.create({
      data: {
        orgId,
        channelId,
        messageId,
        uploaderId: owner.userId,
        name: "osierocony.pdf",
        mimeType: "application/pdf",
        size: 2048,
        key: `test/${uniq}-osierocony.pdf`,
        status: "CLEAN"
      }
    });

    // Oznaczamy wiadomosc jako usunieta z pominieciem serwisu, wiec wiersz
    // pliku ZOSTAJE. Tak wygladalby stan po awarii magazynu w trakcie
    // sprzatania zalacznikow. Sprawdzamy druga warstwe obrony w samym
    // pobieraniu, a nie skutek uboczny kasowania wierszy.
    await app.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() }
    });
    expect(await app.prisma.file.count({ where: { id: file.id } })).toBe(1);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/files/${file.id}/url`,
      headers: auth(reader.token)
    });
    expect(res.statusCode).toBe(404);
  });

  it("drugie usuniecie tej samej wiadomosci konczy sie czytelnym bledem", async () => {
    const sent = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(owner.token),
      payload: { content: "Do podwojnego usuniecia" }
    });
    const messageId = sent.json().id;

    const first = await app.inject({
      method: "DELETE",
      url: `/api/v1/messages/${messageId}`,
      headers: auth(owner.token)
    });
    expect(first.statusCode).toBe(204);

    const second = await app.inject({
      method: "DELETE",
      url: `/api/v1/messages/${messageId}`,
      headers: auth(owner.token)
    });
    expect(second.statusCode).toBe(404);
  });
});
