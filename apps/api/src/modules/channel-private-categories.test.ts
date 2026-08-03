import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// Kategorie prywatne, dobór osób przy tworzeniu kanału prywatnego
// oraz polskie znaki w nazwach kanałów.

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
let insider: Session;
let outsider: Session;
let orgId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`priv-owner-${uniq}@example.com`, "Owner");
  insider = await registerAndLogin(`priv-in-${uniq}@example.com`, "Insider");
  outsider = await registerAndLogin(`priv-out-${uniq}@example.com`, "Outsider");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Prywatne Org", slug: `prywatne-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: insider.userId, orgId, role: "MEMBER" } });
  await app.prisma.membership.create({ data: { userId: outsider.userId, orgId, role: "MEMBER" } });
});

afterAll(async () => {
  await app.close();
});

describe("polskie znaki w nazwie kanału", () => {
  it("przyjmuje nazwę z polskimi literami i zapisuje ją bez zmian", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token),
      payload: { type: "PUBLIC", name: `księgowość-${uniq}` }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe(`księgowość-${uniq}`);
  });

  it("nadal odrzuca wielkie litery i spacje", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token),
      payload: { type: "PUBLIC", name: "Zła Nazwa" }
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("wybór osób przy tworzeniu kanału prywatnego", () => {
  it("dodaje wskazane osoby od razu, pomijając resztę organizacji", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token),
      payload: {
        type: "PRIVATE",
        name: `zespol-wybrany-${uniq}`,
        memberIds: [insider.userId]
      }
    });
    expect(res.statusCode).toBe(201);
    const channelId = res.json().id as string;

    const members = await app.prisma.channelMember.findMany({ where: { channelId } });
    const ids = members.map((m) => m.userId).sort();
    expect(ids).toEqual([owner.userId, insider.userId].sort());
    expect(members.find((m) => m.userId === owner.userId)?.role).toBe("ADMIN");
    expect(members.find((m) => m.userId === insider.userId)?.role).toBe("MEMBER");
  });

  it("odrzuca osobę spoza organizacji", async () => {
    const obcy = await registerAndLogin(`priv-obcy-${uniq}@example.com`, "Obcy");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token),
      payload: { type: "PRIVATE", name: `zespol-obcy-${uniq}`, memberIds: [obcy.userId] }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("MEMBER_NOT_IN_ORG");
  });
});

describe("kategorie prywatne", () => {
  let privateCategoryId: string;

  it("tworzy kategorię prywatną z listą osób", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/categories`,
      headers: auth(owner.token),
      payload: { name: `Zarząd ${uniq}`, private: true, memberIds: [insider.userId] }
    });
    expect(res.statusCode).toBe(201);
    privateCategoryId = res.json().id;
    expect(res.json().private).toBe(true);
    // Twórca dopisywany jest zawsze, inaczej ukryłby kategorię sam przed sobą.
    expect((res.json().memberIds as string[]).sort()).toEqual([owner.userId, insider.userId].sort());
  });

  it("ukrywa kategorię prywatną przed osobą spoza listy", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/categories`,
      headers: auth(outsider.token)
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as Array<{ id: string }>).map((c) => c.id);
    expect(ids).not.toContain(privateCategoryId);
  });

  it("pokazuje kategorię prywatną osobie z listy", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/categories`,
      headers: auth(insider.token)
    });
    const ids = (res.json() as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(privateCategoryId);
  });

  it("pokazuje kategorię prywatną administratorowi organizacji", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/categories`,
      headers: auth(owner.token)
    });
    const ids = (res.json() as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(privateCategoryId);
  });

  it("nie pozwala utworzyć kanału publicznego w kategorii prywatnej", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token),
      payload: { type: "PUBLIC", name: `jawny-${uniq}`, categoryId: privateCategoryId }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("CATEGORY_IS_PRIVATE");
  });

  it("kanał prywatny w kategorii prywatnej dziedziczy jej osoby", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token),
      payload: { type: "PRIVATE", name: `narada-${uniq}`, categoryId: privateCategoryId }
    });
    expect(res.statusCode).toBe(201);

    const members = await app.prisma.channelMember.findMany({ where: { channelId: res.json().id } });
    expect(members.map((m) => m.userId).sort()).toEqual([owner.userId, insider.userId].sort());
  });

  it("nie pozwala przenieść kanału publicznego do kategorii prywatnej", async () => {
    const kanal = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token),
      payload: { type: "PUBLIC", name: `do-przeniesienia-${uniq}` }
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/channels/${kanal.json().id}`,
      headers: auth(owner.token),
      payload: { categoryId: privateCategoryId }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("CATEGORY_IS_PRIVATE");
  });

  it("nie pozwala uprywatnić kategorii zawierającej kanał publiczny", async () => {
    const jawna = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/categories`,
      headers: auth(owner.token),
      payload: { name: `Jawna ${uniq}` }
    });
    const categoryId = jawna.json().id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/channels`,
      headers: auth(owner.token),
      payload: { type: "PUBLIC", name: `w-jawnej-${uniq}`, categoryId }
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/categories/${categoryId}`,
      headers: auth(owner.token),
      payload: { private: true }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CATEGORY_HAS_PUBLIC_CHANNELS");
  });

  it("zdjęcie prywatności czyści listę osób", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/categories/${privateCategoryId}`,
      headers: auth(owner.token),
      payload: { private: false }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().private).toBe(false);
    expect(res.json().memberIds).toEqual([]);

    const widokObcego = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/categories`,
      headers: auth(outsider.token)
    });
    const ids = (widokObcego.json() as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(privateCategoryId);
  });
});
