import { createHmac } from "node:crypto";
import { env } from "../config/env.js";

/**
 * Dane dostępowe do serwera TURN w wariancie czasowym (TURN REST API,
 * `use-auth-secret` po stronie coturna).
 *
 * Przeglądarka nigdy nie dostaje wspólnego sekretu — dostaje nazwę z terminem
 * ważności i jej podpis. Wyciek takiej pary daje najwyżej kilka godzin dostępu
 * do przekaźnika, a nie bezterminowy.
 */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export function turnWlaczony(): boolean {
  return Boolean(env.TURN_SECRET && env.TURN_URLS);
}

/**
 * `userId` trafia do nazwy wyłącznie po to, żeby dało się powiązać ruch
 * na przekaźniku z konkretną osobą przy diagnozowaniu nadużyć.
 */
export function daneDostepoweTurn(userId: string, teraz = Date.now()): IceServer[] {
  const stun: IceServer = { urls: ["stun:stun.l.google.com:19302"] };
  if (!env.TURN_SECRET || !env.TURN_URLS) return [stun];

  const wygasa = Math.floor(teraz / 1000) + env.TURN_TTL_SECONDS;
  const username = `${wygasa}:${userId}`;
  // SHA-1 jest tu narzucone przez protokol (TURN REST API), a nie wybrane -
  // coturn z `use-auth-secret` nie liczy niczego innego. Analiza statyczna
  // zglasza to jako slaby algorytm; w roli MAC z sekretem HMAC-SHA1 pozostaje
  // bezpieczny, a same dane i tak wygasaja po godzinie.
  const credential = createHmac("sha1", env.TURN_SECRET).update(username).digest("base64");

  const adresy = env.TURN_URLS.split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  return [stun, { urls: adresy, username, credential }];
}
