import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// Etap 1 przebudowy zarządzania kanałami w stylu Discorda:
// kategorie, kolejność wspólna dla organizacji, usuwanie kanału,
// kanał ogłoszeniowy i tryb wolny.

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

async function createChannel(session: Session, name: string) {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(session.token),
    payload: { type: "PUBLIC", name }
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

let owner: Session;
let member: Session;
let orgId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`cat-owner-${uniq}@example.com`, "Owner");
  member = await registerAndLogin(`cat-member-${uniq}@example.com`, "Member");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Kategorie Org", slug: `kategorie-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: member.userId, orgId, role: "MEMBER" } });
});

afterAll(async () => {
  await app.close();
});

describe("kategorie kanałów", () => {
  it("administrator tworzy kategorię, zwykły członek nie", async () => {
    const asOwner = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/categories`,
      headers: auth(owner.token),
      payload: { name: "Projekty" }
    });
    expect(asOwner.statusCode).toBe(201);
    expect(asOwner.json().name).toBe("Projekty");
    expect(asOwner.json().position).toBe(0);

    const asMember = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/categories`,
      headers: auth(member.token),
      payload: { name: "Podszywka" }
    });
    expect(asMember.statusCode).toBe(403);
  });

  it("kolejne kategorie trafiają na koniec listy", async () => {
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/categories`,
      headers: auth(owner.token),
      payload: { name: "Archiwum" }
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().position).toBe(1);
  });

  it("odrzuca duplikat nazwy kategorii", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/categories`,
      headers: auth(owner.token),
      payload: { name: "Projekty" }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CATEGORY_EXISTS");
  });

  it("usunięcie kategorii nie usuwa kanałów, tylko zdejmuje przypisanie", async () => {
    const cat = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/categories`,
      headers: auth(owner.token),
      payload: { name: `Tymczasowa-${uniq}` }
    });
    const categoryId = cat.json().id;
    const channelId = await createChannel(owner, `w-kategorii-${uniq}`);

    await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}`,
      headers: auth(owner.token),
      payload: { categoryId }
    });

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/categories/${categoryId}`,
      headers: auth(owner.token)
    });
    expect(del.statusCode).toBe(200);

    const survivor = await app.prisma.channel.findUnique({ where: { id: channelId } });
    expect(survivor).not.toBeNull();
    expect(survivor!.categoryId).toBeNull();
  });
});

describe("układ listy kanałów", () => {
  it("administrator zmienia kolejność, zwykły członek nie", async () => {
    const a = await createChannel(owner, `uklad-a-${uniq}`);
    const b = await createChannel(owner, `uklad-b-${uniq}`);

    const asMember = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/channel-layout`,
      headers: auth(member.token),
      payload: { categories: [], channels: [{ id: a, categoryId: null, position: 5 }] }
    });
    expect(asMember.statusCode).toBe(403);

    const asOwner = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/channel-layout`,
      headers: auth(owner.token),
      payload: {
        categories: [],
        channels: [
          { id: b, categoryId: null, position: 0 },
          { id: a, categoryId: null, position: 1 }
        ]
      }
    });
    expect(asOwner.statusCode).toBe(200);

    const [chA, chB] = await Promise.all([
      app.prisma.channel.findUnique({ where: { id: a } }),
      app.prisma.channel.findUnique({ where: { id: b } })
    ]);
    expect(chB!.position).toBe(0);
    expect(chA!.position).toBe(1);
  });

  it("nie da się przenieść kanału do kategorii z innej organizacji", async () => {
    const outsider = await registerAndLogin(`cat-obcy-${uniq}@example.com`, "Obcy");
    const otherOrg = await app.inject({
      method: "POST",
      url: "/api/v1/orgs",
      headers: auth(outsider.token),
      payload: { name: "Obca", slug: `obca-${uniq}` }
    });
    const otherOrgId = otherOrg.json().id;
    const foreignCat = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${otherOrgId}/categories`,
      headers: auth(outsider.token),
      payload: { name: "Obca kategoria" }
    });
    const foreignCategoryId = foreignCat.json().id;

    const channelId = await createChannel(owner, `obca-proba-${uniq}`);

    const viaLayout = await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/channel-layout`,
      headers: auth(owner.token),
      payload: {
        categories: [],
        channels: [{ id: channelId, categoryId: foreignCategoryId, position: 0 }]
      }
    });
    expect(viaLayout.statusCode).toBe(400);

    const viaPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}`,
      headers: auth(owner.token),
      payload: { categoryId: foreignCategoryId }
    });
    expect(viaPatch.statusCode).toBe(400);

    const untouched = await app.prisma.channel.findUnique({ where: { id: channelId } });
    expect(untouched!.categoryId).toBeNull();
  });
});

describe("usuwanie kanału", () => {
  it("administrator organizacji usuwa kanał wraz z wiadomościami", async () => {
    const channelId = await createChannel(owner, `do-usuniecia-${uniq}`);
    await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(owner.token),
      payload: { content: "Zostanie skasowana razem z kanałem" }
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/channels/${channelId}`,
      headers: auth(owner.token)
    });
    expect(res.statusCode).toBe(200);

    expect(await app.prisma.channel.findUnique({ where: { id: channelId } })).toBeNull();
    expect(await app.prisma.message.count({ where: { channelId } })).toBe(0);
  });

  it("zwykły członek nie usuwa kanału, nawet będąc jego administratorem", async () => {
    // Członek zakłada własny kanał, więc jest w nim ADMIN-em, ale w organizacji
    // pozostaje zwykłym MEMBER-em. Usuwanie wymaga uprawnienia organizacji.
    const channelId = await createChannel(member, `czlonka-${uniq}`);
    const membership = await app.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: member.userId } }
    });
    expect(membership!.role).toBe("ADMIN");

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/channels/${channelId}`,
      headers: auth(member.token)
    });
    expect(res.statusCode).toBe(403);
    expect(await app.prisma.channel.findUnique({ where: { id: channelId } })).not.toBeNull();
  });
});

describe("kanał ogłoszeniowy", () => {
  it("pisać mogą tylko administratorzy kanału, czytać wszyscy", async () => {
    const channelId = await createChannel(owner, `oglosz-${uniq}`);
    const switched = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}`,
      headers: auth(owner.token),
      payload: { kind: "ANNOUNCEMENT" }
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().kind).toBe("ANNOUNCEMENT");

    const byAdmin = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(owner.token),
      payload: { content: "Ogłoszenie" }
    });
    expect(byAdmin.statusCode).toBe(201);

    const byMember = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(member.token),
      payload: { content: "Próba wpisu" }
    });
    expect(byMember.statusCode).toBe(403);

    // Odczyt musi nadal działać dla zwykłego członka.
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(member.token)
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().messages.length).toBeGreaterThan(0);
  });
});

describe("tryb wolny", () => {
  it("blokuje drugą wiadomość w oknie i przepuszcza po jego upływie", async () => {
    const channelId = await createChannel(owner, `wolny-${uniq}`);
    await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}`,
      headers: auth(owner.token),
      payload: { slowmodeSeconds: 30 }
    });

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(member.token),
      payload: { content: "Pierwsza" }
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(member.token),
      payload: { content: "Druga, za szybko" }
    });
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe("SLOWMODE_ACTIVE");

    // Cofamy znacznik czasu poprzedniej wiadomości poza okno — szybsze
    // i pewniejsze niż realne czekanie 30 sekund w teście.
    await app.prisma.message.updateMany({
      where: { channelId, authorId: member.userId },
      data: { createdAt: new Date(Date.now() - 60_000) }
    });

    const third = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${channelId}/messages`,
      headers: auth(member.token),
      payload: { content: "Po odczekaniu" }
    });
    expect(third.statusCode).toBe(201);
  });

  it("nie dotyczy administratorów kanału", async () => {
    const channelId = await createChannel(owner, `wolny-admin-${uniq}`);
    await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${channelId}`,
      headers: auth(owner.token),
      payload: { slowmodeSeconds: 300 }
    });

    for (const content of ["Raz", "Dwa", "Trzy"]) {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/channels/${channelId}/messages`,
        headers: auth(owner.token),
        payload: { content }
      });
      expect(res.statusCode).toBe(201);
    }
  });
});

describe("lista kanałów", () => {
  it("zwraca kategorię, rodzaj i tryb wolny oraz sortuje wspólnie dla organizacji", async () => {
    const cat = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/categories`,
      headers: auth(owner.token),
      payload: { name: `Sortowanie-${uniq}` }
    });
    const categoryId = cat.json().id;
    const first = await createChannel(owner, `sort-pierwszy-${uniq}`);
    const second = await createChannel(owner, `sort-drugi-${uniq}`);

    await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/channel-layout`,
      headers: auth(owner.token),
      payload: {
        categories: [{ id: categoryId, position: 0 }],
        channels: [
          { id: second, categoryId, position: 0 },
          { id: first, categoryId, position: 1 }
        ]
      }
    });

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token)
    });
    expect(list.statusCode).toBe(200);
    const items = list.json() as Array<{
      id: string;
      categoryId: string | null;
      kind: string;
      slowmodeSeconds: number;
      position: number;
    }>;

    const inCategory = items.filter((c) => c.categoryId === categoryId).map((c) => c.id);
    expect(inCategory).toEqual([second, first]);

    const sample = items.find((c) => c.id === first)!;
    expect(sample.kind).toBe("TEXT");
    expect(sample.slowmodeSeconds).toBe(0);
  });
});
