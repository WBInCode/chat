import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import {
  queueForEmailDigest,
  drainBuffer,
  applyCooldown,
  resetEscalation,
  withinDailyCap,
  releasePending,
  FIRST_WINDOW_MS,
  ESCALATION_MS
} from "../lib/email-digest.js";
import { buildDigestChannels, AT_REST_PLACEHOLDER } from "../lib/digest-builder.js";
import { digestSubject, escapeHtml, renderDigestHtml, renderDigestText } from "../lib/email-templates.js";
import { emailDigestQueue } from "../lib/queue.js";

// Zbiorcze powiadomienia e-mail: seria wiadomości ma dać jeden mail.

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

let author: Session;
let reader: Session;
let orgId: string;
let channelId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  author = await registerAndLogin(`mail-author-${uniq}@example.com`, "Anna Kowalska");
  reader = await registerAndLogin(`mail-reader-${uniq}@example.com`, "Piotr Nowak");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(author.token),
    payload: { name: "Mail Test Org", slug: `mail-test-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: reader.userId, orgId, role: "MEMBER" } });

  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(author.token),
    payload: { type: "PUBLIC", name: `mail-${uniq}` }
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

/** Czyści stan grupowania między testami, żeby nie przeciekał. */
async function resetDigestState(userId: string) {
  await app.redis.del(
    `maildigest:items:${userId}`,
    `maildigest:pending:${userId}`,
    `maildigest:cooldown:${userId}`,
    `maildigest:streak:${userId}`,
    `maildigest:cap:${userId}:${new Date().toISOString().slice(0, 10)}`
  );
  await app.redis.del(`presence:${userId}`);
}

beforeEach(async () => {
  await resetDigestState(reader.userId);
  await emailDigestQueue.drain(true);
  // Testy przesuwają znacznik przeczytania i wyciszenie, więc każdy
  // zaczyna od czystego członkostwa.
  await app.prisma.channelMember.update({
    where: { channelId_userId: { channelId, userId: reader.userId } },
    data: { lastReadAt: null, mutedAt: null }
  });
});

/**
 * Rozsyłanie powiadomień jest celowo oderwane od wysłania wiadomości
 * (`void notifyRecipients(...)`), żeby poczta nigdy nie opóźniała wysyłki.
 * Odpowiedź HTTP wraca zanim bufor zostanie zapełniony, więc test musi
 * poczekać na skutek, zamiast zakładać go natychmiast.
 */
async function waitForBuffer(userId: string, expected: number, timeoutMs = 5000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let len = 0;
  while (Date.now() < deadline) {
    len = await app.redis.llen(`maildigest:items:${userId}`);
    if (len >= expected) return len;
    await new Promise((r) => setTimeout(r, 25));
  }
  return len;
}

async function sendMessage(content: string) {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/channels/${channelId}/messages`,
    headers: auth(author.token),
    payload: { content }
  });
  return res.json();
}

describe("grupowanie powiadomień e-mail", () => {
  it("seria wiadomości tworzy JEDNO zaplanowane zadanie, nie jedno na wiadomość", async () => {
    for (let i = 1; i <= 12; i++) {
      await sendMessage(`Wiadomość numer ${i}`);
    }

    expect(await waitForBuffer(reader.userId, 12)).toBe(12);

    // Sedno mechanizmu: dwanaście wiadomości, jedno zadanie wysyłki.
    const delayed = await emailDigestQueue.getDelayed();
    const forReader = delayed.filter((j) => j.data.userId === reader.userId);
    expect(forReader).toHaveLength(1);
  });

  it("planuje wysyłkę dopiero po oknie zbiorczym, a nie natychmiast", async () => {
    await sendMessage("Pierwsza");
    await waitForBuffer(reader.userId, 1);
    const delayed = await emailDigestQueue.getDelayed();
    const job = delayed.find((j) => j.data.userId === reader.userId);
    expect(job).toBeDefined();
    expect(job!.opts.delay).toBe(FIRST_WINDOW_MS);
  });

  it("odstęp między kolejnymi podsumowaniami rośnie, gdy rozmowa trwa", async () => {
    const first = await applyCooldown(app, reader.userId);
    const second = await applyCooldown(app, reader.userId);
    const third = await applyCooldown(app, reader.userId);
    const fourth = await applyCooldown(app, reader.userId);

    expect(first).toBe(ESCALATION_MS[0]);
    expect(second).toBe(ESCALATION_MS[1]);
    expect(third).toBe(ESCALATION_MS[2]);
    // Dalej już nie rośnie, zatrzymuje się na godzinie.
    expect(fourth).toBe(ESCALATION_MS[2]);

    await resetEscalation(app, reader.userId);
    expect(await applyCooldown(app, reader.userId)).toBe(ESCALATION_MS[0]);
  });

  it("w trakcie odstępu nowe wiadomości czekają, zamiast wysyłać kolejnego maila", async () => {
    await applyCooldown(app, reader.userId);
    await app.redis.del(`maildigest:pending:${reader.userId}`);

    await queueForEmailDigest(app, reader.userId, {
      messageId: "00000000-0000-4000-8000-000000000001",
      channelId,
      mention: false
    });

    const delayed = await emailDigestQueue.getDelayed();
    const job = delayed.find((j) => j.data.userId === reader.userId);
    expect(job).toBeDefined();
    // Zadanie czeka do końca odstępu, a nie krótkie okno zbiorcze.
    expect(job!.opts.delay).toBeGreaterThan(FIRST_WINDOW_MS);
    expect(job!.opts.delay).toBeLessThanOrEqual(ESCALATION_MS[0]!);
  });

  it("bufor nie rośnie w nieskończoność przy bardzo długiej serii", async () => {
    for (let i = 0; i < 60; i++) {
      await queueForEmailDigest(app, reader.userId, {
        messageId: `msg-${i}`,
        channelId,
        mention: false
      });
    }
    const buffered = await app.redis.llen(`maildigest:items:${reader.userId}`);
    expect(buffered).toBe(50);
  });

  it("zwolnienie znacznika pozwala zaplanować kolejną serię", async () => {
    await sendMessage("Start serii");
    await waitForBuffer(reader.userId, 1);
    expect(await app.redis.get(`maildigest:pending:${reader.userId}`)).toBe("1");

    await releasePending(app, reader.userId);
    expect(await app.redis.get(`maildigest:pending:${reader.userId}`)).toBeNull();
  });

  it("twardy dzienny limit odcina wysyłkę po przekroczeniu", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await withinDailyCap(app, reader.userId, 3)).toBe(true);
    }
    expect(await withinDailyCap(app, reader.userId, 3)).toBe(false);
  });
});

describe("co trafia do podsumowania", () => {
  it("pomija wiadomości przeczytane po ich zebraniu", async () => {
    const first = await sendMessage("Zanim przeczytał");
    await waitForBuffer(reader.userId, 1);
    const items = await drainBuffer(app, reader.userId);
    expect(items.length).toBeGreaterThan(0);

    // Odbiorca w międzyczasie otworzył kanał.
    await app.prisma.channelMember.update({
      where: { channelId_userId: { channelId, userId: reader.userId } },
      data: { lastReadAt: new Date(Date.now() + 1000) }
    });

    const channels = await buildDigestChannels(app, reader.userId, items);
    expect(channels).toHaveLength(0);
    expect(first.id).toBeDefined();
  });

  it("pomija wiadomości usunięte po ich zebraniu", async () => {
    const msg = await sendMessage("Do usunięcia");
    await waitForBuffer(reader.userId, 1);
    const items = await drainBuffer(app, reader.userId);

    await app.prisma.message.update({ where: { id: msg.id }, data: { deletedAt: new Date() } });

    const channels = await buildDigestChannels(app, reader.userId, items);
    expect(channels).toHaveLength(0);
  });

  it("pomija kanał wyciszony po zebraniu wiadomości", async () => {
    await sendMessage("Przed wyciszeniem");
    await waitForBuffer(reader.userId, 1);
    const items = await drainBuffer(app, reader.userId);

    await app.prisma.channelMember.update({
      where: { channelId_userId: { channelId, userId: reader.userId } },
      data: { mutedAt: new Date() }
    });

    const channels = await buildDigestChannels(app, reader.userId, items);
    expect(channels).toHaveLength(0);
  });

  it("nigdy nie wstawia treści z kanału szyfrowanego end-to-end", async () => {
    const dm = await app.prisma.channel.create({
      data: { orgId, type: "DM", createdBy: author.userId, e2ee: true }
    });
    await app.prisma.channelMember.createMany({
      data: [
        { channelId: dm.id, userId: author.userId },
        { channelId: dm.id, userId: reader.userId }
      ]
    });
    const secret = await app.prisma.message.create({
      data: {
        channelId: dm.id,
        authorId: author.userId,
        content: "SZYFROGRAM-KTOREGO-NIE-WOLNO-POKAZAC",
        contentType: "e2e"
      }
    });

    const channels = await buildDigestChannels(app, reader.userId, [
      { messageId: secret.id, channelId: dm.id, mention: true }
    ]);

    expect(channels).toHaveLength(1);
    const msg = channels[0]!.messages[0]!;
    expect(msg.body).toBe("");
    expect(msg.placeholder).toContain("end-to-end");

    const html = renderDigestHtml("Piotr", channels, 1);
    const text = renderDigestText("Piotr", channels, 1);
    expect(html).not.toContain("SZYFROGRAM");
    expect(text).not.toContain("SZYFROGRAM");
  });

  it("nie wysyła treści poza aplikację, gdy organizacja szyfruje bazę", async () => {
    await app.prisma.organization.update({ where: { id: orgId }, data: { encryptAtRest: true } });
    const { invalidateOrgEncryptionCache } = await import("../lib/message-crypto.js");
    invalidateOrgEncryptionCache(orgId);

    try {
      await sendMessage("TAJNA-TRESC-HANDLOWA");
      await waitForBuffer(reader.userId, 1);
      const items = await drainBuffer(app, reader.userId);
      const channels = await buildDigestChannels(app, reader.userId, items);

      expect(channels).toHaveLength(1);
      const msg = channels[0]!.messages.at(-1)!;
      expect(msg.body).toBe("");
      expect(msg.placeholder).toBe(AT_REST_PLACEHOLDER);

      // Ani w HTML-u, ani w wersji tekstowej nie może pojawić się treść.
      const html = renderDigestHtml("Piotr", channels, 1);
      const text = renderDigestText("Piotr", channels, 1);
      expect(html).not.toContain("TAJNA-TRESC-HANDLOWA");
      expect(text).not.toContain("TAJNA-TRESC-HANDLOWA");
      // Sama informacja o nowej wiadomości i odnośnik nadal są przydatne.
      expect(html).toContain("Otwórz rozmowę");
      expect(html).toContain("Anna Kowalska");
    } finally {
      await app.prisma.organization.update({ where: { id: orgId }, data: { encryptAtRest: false } });
      invalidateOrgEncryptionCache(orgId);
      await app.prisma.channelMember.update({
        where: { channelId_userId: { channelId, userId: reader.userId } },
        data: { lastReadAt: null }
      });
    }
  });

  it("pokazuje treść, gdy organizacja nie szyfruje bazy", async () => {
    await sendMessage("Zwykła jawna wiadomość");
    await waitForBuffer(reader.userId, 1);
    const items = await drainBuffer(app, reader.userId);
    const channels = await buildDigestChannels(app, reader.userId, items);

    expect(channels).toHaveLength(1);
    expect(channels[0]!.messages.at(-1)!.body).toBe("Zwykła jawna wiadomość");

    await app.prisma.channelMember.update({
      where: { channelId_userId: { channelId, userId: reader.userId } },
      data: { lastReadAt: null }
    });
  });

  it("odszyfrowuje starsze wiadomości, gdy organizacja wyłączyła już szyfrowanie", async () => {
    const { invalidateOrgEncryptionCache } = await import("../lib/message-crypto.js");

    // Wiadomość powstaje przy włączonym szyfrowaniu, więc w bazie leży szyfrem.
    await app.prisma.organization.update({ where: { id: orgId }, data: { encryptAtRest: true } });
    invalidateOrgEncryptionCache(orgId);
    await sendMessage("Treść zapisana szyfrem");
    await waitForBuffer(reader.userId, 1);
    const items = await drainBuffer(app, reader.userId);

    // Organizacja wyłącza szyfrowanie: stare wiersze nadal są zaszyfrowane,
    // więc podsumowanie musi je odczytać, a nie pokazać szyfrogramu.
    await app.prisma.organization.update({ where: { id: orgId }, data: { encryptAtRest: false } });
    invalidateOrgEncryptionCache(orgId);

    try {
      const channels = await buildDigestChannels(app, reader.userId, items);
      expect(channels).toHaveLength(1);
      expect(channels[0]!.messages.at(-1)!.body).toBe("Treść zapisana szyfrem");
    } finally {
      await app.prisma.channelMember.update({
        where: { channelId_userId: { channelId, userId: reader.userId } },
        data: { lastReadAt: null }
      });
    }
  });
});

describe("szablon wiadomości", () => {
  it("neutralizuje znaczniki HTML w treści od użytkownika", () => {
    const channels = [
      {
        channelId: "c1",
        title: "ogolny",
        isDm: false,
        omitted: 0,
        messages: [
          {
            authorId: "u1",
            authorName: "<img src=x onerror=alert(1)>",
            createdAt: new Date("2026-07-29T09:00:00Z"),
            body: '<script>alert("xss")</script>',
            placeholder: null,
            mention: false
          }
        ]
      }
    ];

    const html = renderDigestHtml("Piotr", channels, 1);
    // Znaczniki mają zostać tekstem, a nie kodem. Sprawdzamy KONKRETNY ładunek
    // od użytkownika, a nie obecność znacznika w całym dokumencie: nagłówek
    // podsumowania zawiera legalne <img> z logo, więc dawne
    // `not.toContain("<img")` odrzucało poprawnie zescapowany szablon.
    // Ta wersja jest przy okazji ostrzejsza — pilnuje całego ładunku, nie
    // samego początku znacznika. Ciąg "onerror=" wolno zostawić, bo po
    // zamianie nawiasów jest zwykłym napisem.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapeHtml zamienia wszystkie znaki o znaczeniu składniowym", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("tytuł odmienia się poprawnie i podaje liczbę wiadomości", () => {
    const base = {
      channelId: "c1",
      title: "sprzedaz",
      isDm: false,
      omitted: 0,
      messages: [
        {
          authorId: "u1",
          authorName: "Anna",
          createdAt: new Date(),
          body: "x",
          placeholder: null,
          mention: false
        }
      ]
    };
    expect(digestSubject([base], 1)).toContain("Anna");
    expect(digestSubject([base], 5)).toBe("5 nowych wiadomości w #sprzedaz");
    expect(digestSubject([base, { ...base, channelId: "c2" }], 7)).toBe(
      "7 nowych wiadomości w 2 rozmowach"
    );
  });
});
