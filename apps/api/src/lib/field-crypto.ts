import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

// AES-256-GCM field-level encryption for sensitive columns at rest
// (e.g. User.totpSecret). Key comes from FIELD_ENCRYPTION_KEY (base64, 32 bytes).
// Format stored: v1.<iv_base64>.<authTag_base64>.<ciphertext_base64>
// The "v1" prefix allows future key/algorithm rotation.

const KEY = Buffer.from(env.FIELD_ENCRYPTION_KEY, "base64");

if (KEY.length !== 32) {
  throw new Error("FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes (base64)");
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${authTag.toString("base64")}.${ciphertext.toString("base64")}`;
}

export function decryptField(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Unsupported encrypted field format");
  }
  const [, ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64 as string, "base64");
  const authTag = Buffer.from(authTagB64 as string, "base64");
  const ciphertext = Buffer.from(ciphertextB64 as string, "base64");

  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
