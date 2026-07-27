import type { FastifyInstance } from "fastify";
import { encryptField, decryptField } from "./field-crypto.js";

/**
 * Server-side at-rest encryption of message content (AES-256-GCM via
 * field-crypto), enabled per organization (Organization.encryptAtRest).
 *
 * - Encrypt happens ONLY at the DB write; plaintext still flows to
 *   notifications/unfurl/AI at send time, so features keep working.
 * - The Message.encrypted flag marks ciphertext rows, so decryption is
 *   explicit (no prefix heuristics on user text).
 * - E2E messages (contentType "e2e") are never wrapped: they are already
 *   ciphertext produced on the client and the server cannot read them.
 * - Tradeoff: encrypted rows cannot match Postgres FTS, so full-text
 *   search does not cover messages written while encryption is on. This
 *   is stated in the admin UI next to the toggle.
 */

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: boolean; expires: number }>();

export async function isOrgEncryptedAtRest(fastify: FastifyInstance, orgId: string): Promise<boolean> {
  const hit = cache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit.value;
  const org = await fastify.prisma.organization.findUnique({
    where: { id: orgId },
    select: { encryptAtRest: true }
  });
  const value = !!org?.encryptAtRest;
  cache.set(orgId, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Invalidate the cached flag after an admin toggles the setting. */
export function invalidateOrgEncryptionCache(orgId: string) {
  cache.delete(orgId);
}

export function encryptMessageContent(content: string): string {
  return encryptField(content);
}

/** Decrypts a stored message row's content when flagged; passthrough otherwise. */
export function decryptMessageContent(row: { content: string; encrypted?: boolean }): string {
  if (!row.encrypted) return row.content;
  try {
    return decryptField(row.content);
  } catch {
    // Wrong/rotated key: never crash a whole page of messages over one row.
    return "[nie można odszyfrować wiadomości]";
  }
}
