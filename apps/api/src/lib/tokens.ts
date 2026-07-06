import { randomBytes, createHash } from "node:crypto";

/**
 * Refresh tokens are opaque random strings. Only their SHA-256 hash is
 * persisted (Session.refreshHash) — the plaintext value is never stored,
 * mirroring how passwords are never stored in plaintext.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateFamilyId(): string {
  return randomBytes(16).toString("hex");
}
