/**
 * Wspólna reguła: czy ta wiadomość ma o sobie dać znać, i jak głośno.
 *
 * Powstała, bo klient i serwer miały rozjechane warunki. Serwer przy wysyłce
 * push sprawdzał wyciszenie kanału, tryb powiadomień i status "nie
 * przeszkadzać", a klient przed odegraniem dźwięku — wyłącznie wyciszenie.
 * Skutkiem było wrażenie losowości: raz przychodziło powiadomienie bez
 * dźwięku, raz dźwięk bez powiadomienia, a ustawienie "Wyłączone" gasiło push
 * i nie gasiło dzwonka.
 *
 * Funkcja jest czysta — cały stan wchodzi argumentem, więc da się ją sprawdzić
 * testem bez przeglądarki, bazy i gniazda.
 */

export type NotifyMode = "ALL" | "MENTIONS" | "NONE";

/** Wzmianki zbiorowe. `@here` ma na serwerze dodatkowy warunek obecności. */
export const WZMIANKA_ZBIOROWA = /(^|\s)@(channel|wszyscy|kanał|here)(?![\p{L}\p{N}])/iu;

export interface KontekstPowiadomienia {
  /** Autorem jest osoba, której dotyczy decyzja. */
  wlasna: boolean;
  /** `false`, gdy kanał jest nieznany — np. z innej organizacji. */
  kanalZnany: boolean;
  wyciszony: boolean;
  niePrzeszkadzac: boolean;
  tryb: NotifyMode;
  wzmianka: boolean;
  rozmowaPrywatna: boolean;
}

export type Powiadomienie = "brak" | "wiadomosc" | "wzmianka";

export function decydujPowiadomienie(k: KontekstPowiadomienia): Powiadomienie {
  if (k.wlasna) return "brak";
  // Nieznany kanał traktujemy jak wyciszony. Wcześniej `!chan?.muted` dawało
  // tu `true` i dzwoniło za kanały z organizacji, których użytkownik nawet nie
  // widział na liście.
  if (!k.kanalZnany || k.wyciszony) return "brak";
  if (k.niePrzeszkadzac) return "brak";
  if (k.tryb === "NONE") return "brak";

  const osobiste = k.wzmianka || k.rozmowaPrywatna;
  if (k.tryb === "MENTIONS" && !osobiste) return "brak";

  return osobiste ? "wzmianka" : "wiadomosc";
}
