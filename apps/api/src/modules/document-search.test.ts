import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

// Wyszukiwanie dokumentow: dopasowanie po tytule i po tresci elementow
// (akapity, tabele, listy zadan) oraz ograniczenie do kanalow pytajacego.

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
let obcy: Session;
let orgId: string;
let channelId: string;
let documentId: string;

async function szukaj(sesja: Session, fraza: string) {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/search/documents?orgId=${orgId}&q=${encodeURIComponent(fraza)}`,
    headers: auth(sesja.token)
  });
  return res;
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`dok-owner-${uniq}@example.com`, "Wlasciciel");
  obcy = await registerAndLogin(`dok-obcy-${uniq}@example.com`, "Obcy");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Dokumenty Szukanie", slug: `dok-szuk-${uniq}` }
  });
  orgId = org.json().id;
  // Obcy jest w organizacji, ale NIE w kanale — to rozroznienie testujemy.
  await app.prisma.membership.create({ data: { userId: obcy.userId, orgId, role: "MEMBER" } });

  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(owner.token),
    payload: { type: "PRIVATE", name: `dok-${uniq}` }
  });
  channelId = channel.json().id;

  const doc = await app.inject({
    method: "POST",
    url: `/api/v1/channels/${channelId}/documents`,
    headers: auth(owner.token),
    payload: { title: "Raportowanie miesieczne" }
  });
  documentId = doc.json().id;

  const dodajBlok = (data: unknown) =>
    app.inject({
      method: "POST",
      url: `/api/v1/documents/${documentId}/blocks`,
      headers: auth(owner.token),
      payload: { data }
    });

  await dodajBlok({ type: "text", text: "Termin oddania to poniedzialek rano." });
  await dodajBlok({
    type: "table",
    header: ["Pozycja", "Kwota"],
    align: ["left", "right"],
    rows: [["Prowizja partnerska", "1200"]]
  });
  const checklist = await dodajBlok({
    type: "checklist",
    items: [
      { id: "i1", text: "Zebrac faktury od podwykonawcow", checked: false, checkedById: null, checkedAt: null }
    ]
  });
  if (checklist.statusCode !== 201) {
    throw new Error(`nie udalo sie dodac listy zadan: ${checklist.statusCode} ${checklist.body}`);
  }
});

afterAll(async () => {
  await app.close();
});

describe("wyszukiwanie dokumentow", () => {
  it("znajduje po urywku tytulu", async () => {
    // Wlasnie dlatego ILIKE, a nie wyszukiwanie pelnotekstowe: "raport"
    // ma trafic w "Raportowanie", czego konfiguracja simple nie zrobi.
    const res = await szukaj(owner, "raport");
    expect(res.statusCode).toBe(200);
    const wyniki = res.json().results as Array<{ documentId: string; title: string }>;
    expect(wyniki.map((w) => w.documentId)).toContain(documentId);
  });

  it("znajduje po tresci akapitu", async () => {
    const res = await szukaj(owner, "poniedzialek");
    const wyniki = res.json().results as Array<{ documentId: string; snippet: string }>;
    expect(wyniki).toHaveLength(1);
    expect(wyniki[0]!.snippet).toContain("poniedzialek");
  });

  it("znajduje po zawartosci tabeli", async () => {
    const res = await szukaj(owner, "prowizja");
    const wyniki = res.json().results as Array<{ documentId: string }>;
    expect(wyniki.map((w) => w.documentId)).toContain(documentId);
  });

  it("znajduje po pozycji listy zadan", async () => {
    const res = await szukaj(owner, "podwykonawcow");
    const wyniki = res.json().results as Array<{ documentId: string }>;
    expect(wyniki.map((w) => w.documentId)).toContain(documentId);
  });

  it("zwraca dokument raz, mimo wielu dopasowanych elementow", async () => {
    // "o" wystepuje w tytule i w kazdym elemencie.
    const res = await szukaj(owner, "o");
    const wyniki = res.json().results as Array<{ documentId: string }>;
    expect(res.statusCode).toBe(400); // ponizej dwoch znakow
    expect(wyniki).toBeUndefined();

    const res2 = await szukaj(owner, "an");
    const wyniki2 = res2.json().results as Array<{ documentId: string }>;
    expect(wyniki2.filter((w) => w.documentId === documentId)).toHaveLength(1);
  });

  it("nie pokazuje dokumentow z kanalu, do ktorego sie nie nalezy", async () => {
    // Najwazniejszy warunek: czlonkostwo w organizacji NIE wystarcza.
    const res = await szukaj(obcy, "raport");
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual([]);
  });

  it("pomija dokumenty zarchiwizowane", async () => {
    await app.inject({
      method: "DELETE",
      url: `/api/v1/documents/${documentId}`,
      headers: auth(owner.token)
    });
    const res = await szukaj(owner, "raport");
    expect(res.json().results).toEqual([]);
  });
});
