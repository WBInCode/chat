import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer, type Server } from "node:http";
import { buildApp } from "../app.js";
import { formatTaskRef, sanitizeTaskRefTitle, buildTaskUrl, TASK_REF_PATTERN } from "@chatv2/shared";

// Wzmianki o zadaniach: konfiguracja zrodel, wyszukiwanie w aplikacjach
// ekosystemu i budowanie odnosnika plakietki.

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
let orgId: string;
let sourceId: string;

/** Podstawiona aplikacja zrodlowa — zapamietuje, o co i z czym ja zapytano. */
let atrapa: Server;
let atrapaPort: number;
const ostatnieZapytanie = { email: "", q: "", sekret: "" };

const SEKRET = "sekret-zrodla-zadan";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  atrapa = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    ostatnieZapytanie.email = url.searchParams.get("email") ?? "";
    ostatnieZapytanie.q = url.searchParams.get("q") ?? "";
    ostatnieZapytanie.sekret = String(req.headers["x-wb-task-secret"] ?? "");

    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        tasks: [
          { id: "abc123", title: "Naprawic eksport CSV", status: "W toku" },
          // Adres podany przez zrodlo musi zostac zignorowany.
          { id: "def456", title: "Zebranie zespolu", url: "https://zly-adres.example/atak" }
        ]
      })
    );
  });
  await new Promise<void>((resolve) => atrapa.listen(0, "127.0.0.1", resolve));
  atrapaPort = (atrapa.address() as { port: number }).port;

  owner = await registerAndLogin(`zad-owner-${uniq}@example.com`, "Wlasciciel");
  czlonek = await registerAndLogin(`zad-czlonek-${uniq}@example.com`, "Czlonek");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Zadania Org", slug: `zad-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: czlonek.userId, orgId, role: "MEMBER" } });
});

afterAll(async () => {
  await new Promise<void>((resolve) => atrapa.close(() => resolve()));
  await app.close();
});

describe("format wzmianki", () => {
  it("sklada wzmianke rozpoznawana przez wzorzec", () => {
    const wzmianka = formatTaskRef("rytm", "abc123", "Naprawic eksport CSV");
    expect(wzmianka).toBe("!{rytm|abc123|Naprawic eksport CSV}");
    const dopasowanie = wzmianka.match(TASK_REF_PATTERN);
    expect(dopasowanie?.[1]).toBe("rytm");
    expect(dopasowanie?.[2]).toBe("abc123");
    expect(dopasowanie?.[3]).toBe("Naprawic eksport CSV");
  });

  it("usuwa z tytulu znaki, ktore rozerwalyby wzmianke", () => {
    // Bez tego tytul z "|" albo "}" konczylby wzmianke w polowie i reszta
    // wylalaby sie do tresci wiadomosci jako goly tekst.
    const wzmianka = formatTaskRef("rytm", "abc123", "Raport | wersja {robocza}");
    expect(sanitizeTaskRefTitle("Raport | wersja {robocza}")).toBe("Raport wersja robocza");
    expect(wzmianka.match(TASK_REF_PATTERN)?.[3]).toBe("Raport wersja robocza");
  });

  it("koduje identyfikator we wzorze adresu", () => {
    expect(buildTaskUrl("https://rytm.local/zadania/{id}", "a b/c")).toBe(
      "https://rytm.local/zadania/a%20b%2Fc"
    );
  });
});

describe("zrodla zadan", () => {
  it("tworzy zrodlo i nigdy nie zwraca sekretu", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/task-sources`,
      headers: auth(owner.token),
      payload: {
        key: "rytm",
        label: "Rytm",
        searchUrl: `http://127.0.0.1:${atrapaPort}/tasks`,
        secret: SEKRET,
        taskUrlTemplate: "https://rytm.local/zadania/{id}"
      }
    });
    expect(res.statusCode).toBe(201);
    sourceId = res.json().id;
    expect(res.json().secret).toBeUndefined();
    expect(JSON.stringify(res.json())).not.toContain(SEKRET);
  });

  it("w bazie sekret lezy zaszyfrowany", async () => {
    const row = await app.prisma.taskSource.findUnique({ where: { id: sourceId } });
    expect(row?.secretEnc).toBeTruthy();
    expect(row?.secretEnc).not.toContain(SEKRET);
  });

  it("odrzuca wzor adresu bez {id}", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/task-sources`,
      headers: auth(owner.token),
      payload: {
        key: "bezwzoru",
        label: "Bez wzoru",
        searchUrl: `http://127.0.0.1:${atrapaPort}/tasks`,
        secret: SEKRET,
        taskUrlTemplate: "https://rytm.local/zadania"
      }
    });
    expect(res.statusCode).toBe(400);
  });

  it("odrzuca wzor adresu w obcym schemacie", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/task-sources`,
      headers: auth(owner.token),
      payload: {
        key: "zlyschemat",
        label: "Zly schemat",
        searchUrl: `http://127.0.0.1:${atrapaPort}/tasks`,
        secret: SEKRET,
        taskUrlTemplate: "javascript:alert({id})"
      }
    });
    expect(res.statusCode).toBe(400);
  });

  it("zwykly czlonek nie zarzadza zrodlami", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orgs/${orgId}/task-sources`,
      headers: auth(czlonek.token),
      payload: {
        key: "workbase",
        label: "WorkBase",
        searchUrl: `http://127.0.0.1:${atrapaPort}/tasks`,
        secret: SEKRET,
        taskUrlTemplate: "https://praca.local/tasks/{id}"
      }
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("wyszukiwanie zadan", () => {
  it("pyta zrodlo o zadania piszacego i podaje sekret", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/task-search?q=eksport`,
      headers: auth(czlonek.token)
    });
    expect(res.statusCode).toBe(200);
    // Zrodlo musi dostac adres pytajacego, bo tylko ono zna swoje uprawnienia.
    expect(ostatnieZapytanie.email).toBe(czlonek.email);
    expect(ostatnieZapytanie.q).toBe("eksport");
    expect(ostatnieZapytanie.sekret).toBe(SEKRET);
  });

  it("buduje odnosnik ze wzoru, a nie z odpowiedzi zrodla", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/task-search?q=`,
      headers: auth(czlonek.token)
    });
    const wyniki = res.json() as Array<{ id: string; url: string; sourceLabel: string }>;
    expect(wyniki).toHaveLength(2);
    expect(wyniki[0]!.url).toBe("https://rytm.local/zadania/abc123");
    expect(wyniki[0]!.sourceLabel).toBe("Rytm");
    // Adres podstawiony przez zrodlo nie moze trafic do wyniku.
    expect(JSON.stringify(wyniki)).not.toContain("zly-adres.example");
  });

  it("niedostepne zrodlo nie wywraca wyszukiwania", async () => {
    await app.prisma.taskSource.update({
      where: { id: sourceId },
      data: { searchUrl: "http://127.0.0.1:1/nieistnieje" }
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/task-search?q=cokolwiek`,
      headers: auth(czlonek.token)
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);

    await app.prisma.taskSource.update({
      where: { id: sourceId },
      data: { searchUrl: `http://127.0.0.1:${atrapaPort}/tasks` }
    });
  });

  it("osoba spoza organizacji nie wyszukuje", async () => {
    const obcy = await registerAndLogin(`zad-obcy-${uniq}@example.com`, "Obcy");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/task-search?q=`,
      headers: auth(obcy.token)
    });
    // 404, a nie 403: czat nie potwierdza istnienia organizacji komus z zewnatrz.
    expect(res.statusCode).toBe(404);
  });

  it("czlonek dostaje wzory adresow, ale bez sekretow", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orgs/${orgId}/task-source-links`,
      headers: auth(czlonek.token)
    });
    expect(res.statusCode).toBe(200);
    const linki = res.json() as Array<{ key: string; taskUrlTemplate: string }>;
    expect(linki.find((l) => l.key === "rytm")?.taskUrlTemplate).toBe("https://rytm.local/zadania/{id}");
    expect(JSON.stringify(linki)).not.toContain(SEKRET);
  });
});
