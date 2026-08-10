import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";

// Czasowe dane dostepowe do TURN (TURN REST API). Przegladarka NIE moze
// dostac wspolnego sekretu - dostaje nazwe z terminem waznosci i jej podpis.

const SEKRET = "sekret-przekaznika";
const ADRESY = "turn:chat.wb-partners.pl:3478?transport=udp,turn:chat.wb-partners.pl:3478?transport=tcp";

async function zaladuj() {
  // Konfiguracja czytana jest przy imporcie, wiec modul musi powstac na nowo.
  vi.resetModules();
  return await import("../lib/turn.js");
}

const pierwotne = { urls: process.env.TURN_URLS, secret: process.env.TURN_SECRET };

beforeEach(() => {
  process.env.TURN_URLS = ADRESY;
  process.env.TURN_SECRET = SEKRET;
});

afterEach(() => {
  if (pierwotne.urls === undefined) delete process.env.TURN_URLS;
  else process.env.TURN_URLS = pierwotne.urls;
  if (pierwotne.secret === undefined) delete process.env.TURN_SECRET;
  else process.env.TURN_SECRET = pierwotne.secret;
});

describe("dane dostepowe TURN", () => {
  it("bez sekretu zwraca sam STUN", async () => {
    delete process.env.TURN_SECRET;
    const { daneDostepoweTurn, turnWlaczony } = await zaladuj();

    expect(turnWlaczony()).toBe(false);
    const wynik = daneDostepoweTurn("u1");
    expect(wynik).toHaveLength(1);
    expect(wynik[0]!.urls[0]).toMatch(/^stun:/);
    expect(wynik[0]!.credential).toBeUndefined();
  });

  it("nie oddaje wspolnego sekretu", async () => {
    const { daneDostepoweTurn } = await zaladuj();
    const wynik = daneDostepoweTurn("u1");
    expect(JSON.stringify(wynik)).not.toContain(SEKRET);
  });

  it("nazwa zawiera termin waznosci i podpis zgadza sie z HMAC", async () => {
    const { daneDostepoweTurn } = await zaladuj();
    const teraz = 1_700_000_000_000;
    const wpis = daneDostepoweTurn("u-anna", teraz)[1]!;

    const [wygasa, userId] = wpis.username!.split(":");
    expect(userId).toBe("u-anna");
    expect(Number(wygasa)).toBeGreaterThan(Math.floor(teraz / 1000));

    const oczekiwany = createHmac("sha1", SEKRET).update(wpis.username!).digest("base64");
    expect(wpis.credential).toBe(oczekiwany);
  });

  it("dane roznia sie miedzy osobami", async () => {
    const { daneDostepoweTurn } = await zaladuj();
    const a = daneDostepoweTurn("u-anna", 1_700_000_000_000)[1]!;
    const b = daneDostepoweTurn("u-bartek", 1_700_000_000_000)[1]!;
    expect(a.username).not.toBe(b.username);
    expect(a.credential).not.toBe(b.credential);
  });

  it("przekazuje wszystkie skonfigurowane adresy", async () => {
    const { daneDostepoweTurn } = await zaladuj();
    const wpis = daneDostepoweTurn("u1")[1]!;
    expect(wpis.urls).toEqual([
      "turn:chat.wb-partners.pl:3478?transport=udp",
      "turn:chat.wb-partners.pl:3478?transport=tcp"
    ]);
  });

  it("zostawia STUN jako pierwszy wybor", async () => {
    // Polaczenie bezposrednie jest tansze i szybsze; TURN to ostatnia deska.
    const { daneDostepoweTurn } = await zaladuj();
    const wynik = daneDostepoweTurn("u1");
    expect(wynik[0]!.urls[0]).toMatch(/^stun:/);
    expect(wynik[1]!.urls[0]).toMatch(/^turn:/);
  });
});
