import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { createMessageService, type MessageService } from "./messages/service.js";
import { czyZakonczycRozmowe } from "../workers/voice-timeout.worker.js";

// Wiadomość systemowa o rozpoczęciu rozmowy głosowej oraz warunek
// automatycznego zakończenia przy braku odzewu.

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
let drugi: Session;
let orgId: string;
let channelId: string;
let messages: MessageService;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();
  messages = createMessageService(app);

  owner = await registerAndLogin(`glos-${uniq}@example.com`, "Zakladajacy");
  drugi = await registerAndLogin(`glos2-${uniq}@example.com`, "Drugi");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Glos Org", slug: `glos-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: drugi.userId, orgId, role: "MEMBER" } });

  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(owner.token),
    payload: { type: "PUBLIC", name: `rozmowy-${uniq}` }
  });
  channelId = channel.json().id;
});

afterAll(async () => {
  await app.close();
});

describe("wiadomosc systemowa", () => {
  it("zapisuje notke z typem system i zwraca ja w historii kanalu", async () => {
    const dto = await messages.sendSystemMessage(
      channelId,
      owner.userId,
      "Rozmowa głosowa rozpoczęta przez Zakladajacy"
    );
    expect(dto.contentType).toBe("system");
    expect(dto.content).toContain("Rozmowa głosowa rozpoczęta");

    const lista = await app.inject({
      method: "GET",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(owner.token)
    });
    expect(lista.statusCode).toBe(200);
    const notka = (lista.json().messages as Array<{ id: string; contentType: string }>).find(
      (m) => m.id === dto.id
    );
    expect(notka?.contentType).toBe("system");
  });

  it("omija blokade kanalu ogloszeniowego", async () => {
    const kanal = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token),
      payload: { type: "PUBLIC", kind: "ANNOUNCEMENT", name: `oglosz-glos-${uniq}` }
    });
    const ogloszeniowyId = kanal.json().id as string;
    await app.prisma.channelMember.updateMany({
      where: { channelId: ogloszeniowyId, userId: drugi.userId },
      data: { role: "MEMBER" }
    });

    // Zwykła wiadomość od nie-administratora jest odrzucana...
    await expect(messages.sendMessage(drugi.userId, ogloszeniowyId, "proba")).rejects.toThrow();

    // ...ale notka systemowa musi przejść, bo to komunikat aplikacji.
    const dto = await messages.sendSystemMessage(
      ogloszeniowyId,
      drugi.userId,
      "Rozmowa głosowa rozpoczęta przez Drugi"
    );
    expect(dto.contentType).toBe("system");
  });

  it("klient nie moze podszyc sie pod wiadomosc systemowa", async () => {
    const { sendMessageSchema } = await import("@chatv2/shared");
    const wynik = sendMessageSchema.safeParse({
      channelId,
      content: "podszywka",
      contentType: "system"
    });
    expect(wynik.success).toBe(false);
  });
});

describe("zakonczenie rozmowy bez odzewu", () => {
  const usersKey = () => `voice:room:${channelId}:users`;
  const mutedKey = () => `voice:room:${channelId}:muted`;

  /**
   * Warunek pobierany wprost z workera, żeby test nie sprawdzał kopii logiki.
   * Stan czytamy z Redisa tak samo jak on, ale bez czekania trzech minut.
   */
  async function czyKonczyc(starterId: string) {
    const uczestnicy = await app.redis.smembers(usersKey());
    return czyZakonczycRozmowe(uczestnicy, starterId);
  }

  it("konczy, gdy zakladajacy jest sam", async () => {
    await app.redis.del(usersKey(), mutedKey());
    await app.redis.sadd(usersKey(), owner.userId);
    expect(await czyKonczyc(owner.userId)).toBe(true);
  });

  it("nie konczy, gdy ktos dolaczyl", async () => {
    await app.redis.del(usersKey(), mutedKey());
    await app.redis.sadd(usersKey(), owner.userId, drugi.userId);
    expect(await czyKonczyc(owner.userId)).toBe(false);
  });

  it("nie konczy pustego pokoju, bo rozmowa juz sie skonczyla", async () => {
    await app.redis.del(usersKey(), mutedKey());
    expect(await czyKonczyc(owner.userId)).toBe(false);
  });

  it("nie konczy, gdy zostala inna osoba niz zakladajacy", async () => {
    await app.redis.del(usersKey(), mutedKey());
    await app.redis.sadd(usersKey(), drugi.userId);
    expect(await czyKonczyc(owner.userId)).toBe(false);
    await app.redis.del(usersKey(), mutedKey());
  });
});
