import { describe, it, expect } from "vitest";
import { odbiorcyKomentarza, type CzlonekDoPowiadomienia } from "./documents/service.js";

// Kto dostaje powiadomienie o komentarzu w dokumencie. Regula jest waska
// celowo: komentarze potrafia sie sypac seriami przy jednym przegladzie,
// a powiadamianie calego kanalu skonczyloby sie wyciszeniem kanalu.

function czlonek(
  userId: string,
  displayName: string,
  opcje: { mutedAt?: Date; notifyMode?: string } = {}
): CzlonekDoPowiadomienia {
  return {
    userId,
    mutedAt: opcje.mutedAt ?? null,
    user: { displayName, notifyMode: opcje.notifyMode ?? "ALL" }
  };
}

const ANNA = czlonek("u-anna", "Anna Nowak");
const BARTEK = czlonek("u-bartek", "Bartek Kowal");
const CELINA = czlonek("u-celina", "Celina Wisniewska");

describe("odbiorcy komentarza w dokumencie", () => {
  it("powiadamia autora dokumentu", async () => {
    const wynik = odbiorcyKomentarza({
      czlonkowie: [ANNA, BARTEK, CELINA],
      autorKomentarzaId: BARTEK.userId,
      autorDokumentuId: ANNA.userId,
      autorBlokuId: null,
      tresc: "Czy to jest jeszcze aktualne?"
    });
    expect(wynik).toEqual([ANNA.userId]);
  });

  it("powiadamia autora omawianego elementu", async () => {
    const wynik = odbiorcyKomentarza({
      czlonkowie: [ANNA, BARTEK, CELINA],
      autorKomentarzaId: ANNA.userId,
      autorDokumentuId: ANNA.userId,
      autorBlokuId: CELINA.userId,
      tresc: "Ta tabela sie nie sumuje."
    });
    expect(wynik).toEqual([CELINA.userId]);
  });

  it("powiadamia osobe wskazana przez @", async () => {
    const wynik = odbiorcyKomentarza({
      czlonkowie: [ANNA, BARTEK, CELINA],
      autorKomentarzaId: ANNA.userId,
      autorDokumentuId: ANNA.userId,
      autorBlokuId: null,
      tresc: "@Bartek Kowal zerknij prosze"
    });
    expect(wynik).toEqual([BARTEK.userId]);
  });

  it("nie powiadamia autora wlasnego komentarza", async () => {
    // Nawet gdy komentuje wlasny dokument i wskaze sam siebie.
    const wynik = odbiorcyKomentarza({
      czlonkowie: [ANNA, BARTEK],
      autorKomentarzaId: ANNA.userId,
      autorDokumentuId: ANNA.userId,
      autorBlokuId: ANNA.userId,
      tresc: "@Anna Nowak notatka dla siebie"
    });
    expect(wynik).toEqual([]);
  });

  it("nie powiadamia reszty kanalu", async () => {
    // Najwazniejszy warunek: komentarz nie jest ogloszeniem dla wszystkich.
    const wynik = odbiorcyKomentarza({
      czlonkowie: [ANNA, BARTEK, CELINA],
      autorKomentarzaId: ANNA.userId,
      autorDokumentuId: ANNA.userId,
      autorBlokuId: null,
      tresc: "Notatka bez adresata"
    });
    expect(wynik).toEqual([]);
  });

  it("szanuje wyciszenie kanalu", async () => {
    const wyciszony = czlonek("u-bartek", "Bartek Kowal", { mutedAt: new Date() });
    const wynik = odbiorcyKomentarza({
      czlonkowie: [ANNA, wyciszony],
      autorKomentarzaId: ANNA.userId,
      autorDokumentuId: wyciszony.userId,
      autorBlokuId: null,
      tresc: "@Bartek Kowal pilne"
    });
    expect(wynik).toEqual([]);
  });

  it("szanuje wylaczone powiadomienia", async () => {
    const bezPowiadomien = czlonek("u-bartek", "Bartek Kowal", { notifyMode: "NONE" });
    const wynik = odbiorcyKomentarza({
      czlonkowie: [ANNA, bezPowiadomien],
      autorKomentarzaId: ANNA.userId,
      autorDokumentuId: bezPowiadomien.userId,
      autorBlokuId: null,
      tresc: "cokolwiek"
    });
    expect(wynik).toEqual([]);
  });

  it("nie powiadamia dwa razy tej samej osoby", async () => {
    // Autor dokumentu, autor bloku i wskazany moga byc ta sama osoba.
    const wynik = odbiorcyKomentarza({
      czlonkowie: [ANNA, BARTEK],
      autorKomentarzaId: BARTEK.userId,
      autorDokumentuId: ANNA.userId,
      autorBlokuId: ANNA.userId,
      tresc: "@Anna Nowak popraw prosze"
    });
    expect(wynik).toEqual([ANNA.userId]);
  });

  it("pomija autora dokumentu, ktory nie jest juz w kanale", async () => {
    // Autor moglo usunac z kanalu; nie ma go wtedy wsrod czlonkow.
    const wynik = odbiorcyKomentarza({
      czlonkowie: [BARTEK],
      autorKomentarzaId: BARTEK.userId,
      autorDokumentuId: "u-usuniety",
      autorBlokuId: null,
      tresc: "cokolwiek"
    });
    expect(wynik).toEqual([]);
  });
});
