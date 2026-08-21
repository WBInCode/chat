import { describe, it, expect } from "vitest";
import { decydujPowiadomienie, WZMIANKA_ZBIOROWA, type KontekstPowiadomienia } from "@chatv2/shared";

// Reguła mieszka w @chatv2/shared, bo korzysta z niej klient (dźwięk) i ma być
// jedną definicją zamiast dwóch rozjeżdżających się. Test siedzi tutaj, bo to
// jedyny pakiet w repo z uruchamialnym vitestem — dokładanie drugiego runnera
// tylko dla kilku asercji nie jest tego warte.

const bazowy: KontekstPowiadomienia = {
  wlasna: false,
  kanalZnany: true,
  wyciszony: false,
  niePrzeszkadzac: false,
  tryb: "ALL",
  wzmianka: false,
  rozmowaPrywatna: false
};

const z = (nadpisz: Partial<KontekstPowiadomienia>) => decydujPowiadomienie({ ...bazowy, ...nadpisz });

describe("decydujPowiadomienie", () => {
  it("zwykła wiadomość w trybie ALL brzmi", () => {
    expect(z({})).toBe("wiadomosc");
  });

  it("własna wiadomość jest cicha", () => {
    expect(z({ wlasna: true })).toBe("brak");
  });

  it("nieznany kanał jest cichy — to kanał z innej organizacji", () => {
    // Regresja: gateway zapisuje socket do kanałów ze wszystkich organizacji,
    // a store trzyma tylko aktywną. Poprzednie `!chan?.muted` dawało tu `true`.
    expect(z({ kanalZnany: false })).toBe("brak");
  });

  it("wyciszony kanał jest cichy", () => {
    expect(z({ wyciszony: true })).toBe("brak");
  });

  it('tryb "nie przeszkadzać" wycisza wszystko, łącznie ze wzmiankami', () => {
    expect(z({ niePrzeszkadzac: true })).toBe("brak");
    expect(z({ niePrzeszkadzac: true, wzmianka: true })).toBe("brak");
  });

  it('tryb NONE wycisza wszystko — wcześniej gasił push, a dzwonek grał dalej', () => {
    expect(z({ tryb: "NONE" })).toBe("brak");
    expect(z({ tryb: "NONE", wzmianka: true })).toBe("brak");
    expect(z({ tryb: "NONE", rozmowaPrywatna: true })).toBe("brak");
  });

  it("tryb MENTIONS przepuszcza tylko wzmianki i rozmowy prywatne", () => {
    expect(z({ tryb: "MENTIONS" })).toBe("brak");
    expect(z({ tryb: "MENTIONS", wzmianka: true })).toBe("wzmianka");
    expect(z({ tryb: "MENTIONS", rozmowaPrywatna: true })).toBe("wzmianka");
  });

  it("wzmianka i rozmowa prywatna dostają własny dźwięk także w trybie ALL", () => {
    expect(z({ wzmianka: true })).toBe("wzmianka");
    expect(z({ rozmowaPrywatna: true })).toBe("wzmianka");
  });
});

describe("WZMIANKA_ZBIOROWA", () => {
  it("łapie formy zbiorowe na początku i w środku zdania", () => {
    for (const tekst of ["@channel zebranie", "hej @wszyscy", "@here szybkie pytanie", "no i @kanał"]) {
      expect(WZMIANKA_ZBIOROWA.test(tekst), tekst).toBe(true);
    }
  });

  it("nie łapie wyrazów, które tylko zaczynają się tak samo", () => {
    // Bez granicy wyrazu "@channels" liczyłoby się jak wołanie całego kanału.
    for (const tekst of ["@channels", "@herezja", "@wszyscyzy", "mail@here.pl"]) {
      expect(WZMIANKA_ZBIOROWA.test(tekst), tekst).toBe(false);
    }
  });
});
