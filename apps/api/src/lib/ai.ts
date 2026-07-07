import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";

/**
 * Zero-cost AI provider abstraction (F5-D). Primary = Groq (OpenAI-compatible,
 * generous free tier), fallback = Google AI Studio (Gemini) when Groq
 * returns 429 or is not configured. Both API keys are server-side only
 * (never sent to the client) and both are OPTIONAL — with neither key set,
 * `isAiEnabled()` returns false and every AI route/feature stays hidden
 * rather than crashing.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function isAiEnabled(): boolean {
  return !!(env.GROQ_API_KEY || env.GEMINI_API_KEY);
}

const AI_QUOTA_TTL_SECONDS = 60 * 60 * 26; // a little over a day, so the key naturally expires

/** Redis-backed hard daily budget shared across the whole org/install — never call paid tiers. */
export async function checkAndConsumeQuota(fastify: FastifyInstance): Promise<boolean> {
  const key = `ai-quota:${new Date().toISOString().slice(0, 10)}`;
  const count = await fastify.redis.incr(key);
  if (count === 1) {
    await fastify.redis.expire(key, AI_QUOTA_TTL_SECONDS);
  }
  return count <= env.AI_DAILY_LIMIT;
}

export class AiQuotaExceededError extends Error {
  constructor() {
    super("Dzienny darmowy limit zapytań AI został wyczerpany. Spróbuj ponownie jutro.");
  }
}

export class AiDisabledError extends Error {
  constructor() {
    super("Asystent AI nie jest skonfigurowany w tym środowisku.");
  }
}

async function callGroq(messages: ChatMessage[]): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages,
      max_tokens: 800,
      temperature: 0.5
    })
  });

  if (res.status === 429) {
    throw new RetryableProviderError("Groq rate limited");
  }
  if (!res.ok) {
    throw new Error(`Groq API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message.content ?? "";
}

class RetryableProviderError extends Error {}

async function callGemini(messages: ChatMessage[]): Promise<string> {
  // Gemini has no "system" role — fold system messages into the first user turn.
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const conversational = messages.filter((m) => m.role !== "system");

  const contents = conversational.map((m, i) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: i === 0 && systemParts.length ? `${systemParts.join("\n")}\n\n${m.content}` : m.content }]
  }));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: 800, temperature: 0.5 } })
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    candidates: { content: { parts: { text: string }[] } }[];
  };
  return data.candidates[0]?.content.parts.map((p) => p.text).join("") ?? "";
}

/**
 * Groq first (fast, generous free tier), Gemini as fallback when Groq is
 * rate-limited or not configured. Throws AiDisabledError if neither
 * provider is configured — callers must check isAiEnabled() first to give
 * a clean UX instead of relying on this throw.
 */
export async function chatCompletion(fastify: FastifyInstance, messages: ChatMessage[]): Promise<string> {
  if (!isAiEnabled()) throw new AiDisabledError();

  const withinBudget = await checkAndConsumeQuota(fastify);
  if (!withinBudget) throw new AiQuotaExceededError();

  if (env.GROQ_API_KEY) {
    try {
      return await callGroq(messages);
    } catch (err) {
      if (!(err instanceof RetryableProviderError) || !env.GEMINI_API_KEY) {
        if (err instanceof RetryableProviderError && !env.GEMINI_API_KEY) {
          throw new Error("Groq jest chwilowo przeciążony, a brak skonfigurowanego dostawcy zapasowego (Gemini).");
        }
        throw err;
      }
      fastify.log.warn("Groq rate-limited, falling back to Gemini");
    }
  }

  if (env.GEMINI_API_KEY) {
    return await callGemini(messages);
  }

  throw new AiDisabledError();
}
