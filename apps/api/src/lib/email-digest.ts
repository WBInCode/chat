import type { FastifyInstance } from "fastify";
import { enqueueEmailDigest } from "./queue.js";
import { isMailConfigured } from "./mailer.js";

/**
 * Grupowanie powiadomień e-mail (na wzór Google Workspace).
 *
 * Problem: kanał, w którym w minutę pada trzydzieści wiadomości, nie może
 * wygenerować trzydziestu maili. Rozwiązanie ma dwie warstwy:
 *
 * 1. OKNO ZBIORCZE — pierwsza wiadomość nie wysyła maila, tylko uruchamia
 *    licznik. Wszystko, co przyjdzie w tym czasie, dokłada się do jednego
 *    podsumowania. Trzydzieści wiadomości daje jeden mail.
 *
 * 2. ROSNĄCY ODSTĘP — po wysłaniu podsumowania kolejne są coraz rzadsze
 *    (10, 30, 60 minut), dopóki rozmowa trwa. Bez tego długa dyskusja
 *    dawałaby mail co okno zbiorcze, czyli znowu spam. Odstęp wraca do
 *    początku, gdy rozmowa ucichnie.
 *
 * Decyzja "czy w ogóle wysyłać" zapada dopiero w momencie wysyłki, nie w
 * chwili nadejścia wiadomości. Dzięki temu ktoś, kto w międzyczasie
 * przeczytał kanał albo wrócił do aplikacji, nie dostaje maila o czymś,
 * co już widział.
 */

/** Ile czekamy na dokładki, zanim wyślemy pierwsze podsumowanie serii. */
export const FIRST_WINDOW_MS = 3 * 60_000;

/** Odstępy po kolejnych podsumowaniach tej samej, trwającej rozmowy. */
export const ESCALATION_MS = [10 * 60_000, 30 * 60_000, 60 * 60_000];

/** Cisza dłuższa niż to zeruje eskalację — nowa rozmowa zaczyna od nowa. */
const STREAK_TTL_SECONDS = 2 * 60 * 60;

/** Górny limit zapamiętanych wiadomości; nadmiar podsumowujemy liczbowo. */
export const MAX_BUFFERED = 50;

const BUFFER_TTL_SECONDS = 24 * 60 * 60;

export interface DigestItem {
  messageId: string;
  channelId: string;
  /** Czy to była wzmianka lub wiadomość bezpośrednia (decyduje o trybie MENTIONS). */
  mention: boolean;
}

const itemsKey = (userId: string) => `maildigest:items:${userId}`;
const pendingKey = (userId: string) => `maildigest:pending:${userId}`;
const cooldownKey = (userId: string) => `maildigest:cooldown:${userId}`;
const streakKey = (userId: string) => `maildigest:streak:${userId}`;
const capKey = (userId: string) => `maildigest:cap:${userId}:${new Date().toISOString().slice(0, 10)}`;

/**
 * Dokłada wiadomość do bufora odbiorcy i — jeśli nie ma jeszcze
 * zaplanowanej wysyłki — planuje ją. Kolejne wiadomości w tym samym oknie
 * trafiają do istniejącego bufora i nie tworzą nowych zadań.
 */
export async function queueForEmailDigest(
  fastify: FastifyInstance,
  userId: string,
  item: DigestItem
): Promise<void> {
  if (!isMailConfigured()) return;

  // Jeden obieg zamiast trzech: przy serii wiadomości w kanale z setką osób
  // ta ścieżka wykonuje się bardzo często, więc każdy zaoszczędzony obieg
  // do Redisa się liczy.
  await fastify.redis
    .multi()
    .rpush(itemsKey(userId), JSON.stringify(item))
    // Bufor nie może rosnąć w nieskończoność; zostawiamy najnowsze wpisy.
    .ltrim(itemsKey(userId), -MAX_BUFFERED, -1)
    .expire(itemsKey(userId), BUFFER_TTL_SECONDS)
    .exec();

  const cooldownLeftMs = await fastify.redis.pttl(cooldownKey(userId));
  const delay = cooldownLeftMs > 0 ? cooldownLeftMs : FIRST_WINDOW_MS;

  // Znacznik NX pełni rolę blokady: tylko pierwsza wiadomość serii planuje
  // zadanie. Znacznik wygasa nieco po terminie wysyłki, więc gdyby zadanie
  // przepadło, kolejna wiadomość zaplanuje je ponownie.
  const claimed = await fastify.redis.set(
    pendingKey(userId),
    "1",
    "PX",
    delay + 60_000,
    "NX"
  );
  if (!claimed) return;

  await enqueueEmailDigest({ userId }, delay);
}

/** Zwalnia znacznik na początku przetwarzania, żeby nowe wiadomości mogły zaplanować kolejną wysyłkę. */
export async function releasePending(fastify: FastifyInstance, userId: string): Promise<void> {
  await fastify.redis.del(pendingKey(userId));
}

/** Pobiera i czyści bufor odbiorcy. */
export async function drainBuffer(fastify: FastifyInstance, userId: string): Promise<DigestItem[]> {
  const raw = await fastify.redis.lrange(itemsKey(userId), 0, -1);
  await fastify.redis.del(itemsKey(userId));
  const items: DigestItem[] = [];
  for (const entry of raw) {
    try {
      items.push(JSON.parse(entry) as DigestItem);
    } catch {
      // Uszkodzony wpis pomijamy, zamiast wywracać całe podsumowanie.
    }
  }
  return items;
}

/** Wkłada z powrotem wpisy, których nie udało się wysłać (np. awaria SMTP). */
export async function restoreBuffer(
  fastify: FastifyInstance,
  userId: string,
  items: DigestItem[]
): Promise<void> {
  if (items.length === 0) return;
  await fastify.redis.rpush(itemsKey(userId), ...items.map((i) => JSON.stringify(i)));
  await fastify.redis.ltrim(itemsKey(userId), -MAX_BUFFERED, -1);
  await fastify.redis.expire(itemsKey(userId), BUFFER_TTL_SECONDS);
}

/** Po wysłanym podsumowaniu wydłuża odstęp do następnego. */
export async function applyCooldown(fastify: FastifyInstance, userId: string): Promise<number> {
  const streak = await fastify.redis.incr(streakKey(userId));
  await fastify.redis.expire(streakKey(userId), STREAK_TTL_SECONDS);

  const index = Math.min(streak - 1, ESCALATION_MS.length - 1);
  const cooldown = ESCALATION_MS[index]!;
  await fastify.redis.set(cooldownKey(userId), "1", "PX", cooldown);
  return cooldown;
}

/** Rozmowa ucichła — kolejna seria znów zacznie od krótkiego okna. */
export async function resetEscalation(fastify: FastifyInstance, userId: string): Promise<void> {
  await fastify.redis.del(streakKey(userId));
}

/**
 * Ostatni bezpiecznik: nawet przy błędzie w logice grupowania jedna osoba
 * nie dostanie więcej niż ustalona liczba maili dziennie.
 */
export async function withinDailyCap(
  fastify: FastifyInstance,
  userId: string,
  limit: number
): Promise<boolean> {
  const key = capKey(userId);
  const count = await fastify.redis.incr(key);
  if (count === 1) await fastify.redis.expire(key, 36 * 60 * 60);
  return count <= limit;
}
