import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { resolveFileMimeType, canonicalMimeType } from "@chatv2/shared";

// Przesyłanie archiwów: warianty nazw typu zgłaszane przez przeglądarki oraz
// zgodność deklaracji z sygnaturą pliku.

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

/** Minimalny, poprawny nagłówek archiwum ZIP. */
function bajtyZip(): Buffer {
  const b = Buffer.alloc(64);
  b.write("PK\u0003\u0004", 0, "latin1");
  b.writeUInt16LE(20, 4);
  return b;
}

let owner: Session;
let orgId: string;
let channelId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`arch-${uniq}@example.com`, "Archiwista");
  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Archiwa Org", slug: `archiwa-${uniq}` }
  });
  orgId = org.json().id;

  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(owner.token),
    payload: { type: "PUBLIC", name: `pliki-${uniq}` }
  });
  channelId = channel.json().id;
});

afterAll(async () => {
  await app.close();
});

describe("rozpoznawanie typu archiwum", () => {
  it("sprowadza warianty nazw tego samego formatu do jednej postaci", () => {
    expect(canonicalMimeType("application/x-zip-compressed")).toBe("application/zip");
    expect(canonicalMimeType("application/vnd.rar")).toBe("application/x-rar-compressed");
    expect(canonicalMimeType("application/x-gzip")).toBe("application/gzip");
    // Typy spoza mapy zostają nietknięte.
    expect(canonicalMimeType("application/pdf")).toBe("application/pdf");
  });

  it("uzupelnia brakujacy typ na podstawie rozszerzenia", () => {
    expect(resolveFileMimeType("paczka.rar", "")).toBe("application/x-rar-compressed");
    expect(resolveFileMimeType("kopia.7z", "")).toBe("application/x-7z-compressed");
    expect(resolveFileMimeType("archiwum.tar.gz", "")).toBe("application/gzip");
    // Typ zgłoszony przez przeglądarkę ma pierwszeństwo.
    expect(resolveFileMimeType("plik.zip", "application/x-zip-compressed")).toBe(
      "application/x-zip-compressed"
    );
    expect(resolveFileMimeType("plik.dziwne", "")).toBe("");
  });
});

describe("przyjmowanie archiwow", () => {
  it("przyjmuje zip zgloszony jako application/x-zip-compressed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/files/presign",
      headers: auth(owner.token),
      payload: {
        channelId,
        name: "paczka.zip",
        size: 64,
        mimeType: "application/x-zip-compressed"
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().uploadUrl).toBeTruthy();
  });

  for (const [nazwa, typ] of [
    ["archiwum.rar", "application/vnd.rar"],
    ["archiwum.rar", "application/x-rar-compressed"],
    ["kopia.7z", "application/x-7z-compressed"],
    ["dane.tar", "application/x-tar"],
    ["dane.tar.gz", "application/gzip"]
  ] as const) {
    it(`przyjmuje ${nazwa} jako ${typ}`, async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/files/presign",
        headers: auth(owner.token),
        payload: { channelId, name: nazwa, size: 128, mimeType: typ }
      });
      expect(res.statusCode).toBe(200);
    });
  }

  it("nadal odrzuca typ spoza listy", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/files/presign",
      headers: auth(owner.token),
      payload: { channelId, name: "skrypt.exe", size: 128, mimeType: "application/x-msdownload" }
    });
    expect(res.statusCode).toBe(400);
  });

  /**
   * Sedno poprawki: przeglądarka deklaruje application/x-zip-compressed,
   * a rozpoznanie po sygnaturze zwraca application/zip. Porównanie dosłowne
   * odrzucało taki plik jako podszywający się pod inny typ.
   */
  it("nie odrzuca zipa przez rozna nazwe tego samego typu", async () => {
    const presign = await app.inject({
      method: "POST",
      url: "/api/v1/files/presign",
      headers: auth(owner.token),
      payload: {
        channelId,
        name: "raport.zip",
        size: 64,
        mimeType: "application/x-zip-compressed"
      }
    });
    expect(presign.statusCode).toBe(200);
    const { fileId, uploadUrl } = presign.json();

    const wyslanie = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/x-zip-compressed" },
      body: new Uint8Array(bajtyZip())
    });
    expect(wyslanie.ok).toBe(true);

    const complete = await app.inject({
      method: "POST",
      url: `/api/v1/files/${fileId}/complete`,
      headers: auth(owner.token),
      payload: {}
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().mimeType).toBe("application/x-zip-compressed");
  });
});
