// End-to-end encryption for 1:1 DMs (opt-in per conversation).
//
// Crypto: NaCl box = X25519 (ECDH) + XSalsa20-Poly1305 (tweetnacl, audited,
// zero dependencies). Both participants derive the same shared secret, so
// the SENDER can also decrypt their own messages with (peerPublicKey,
// mySecretKey).
//
// Key model (MVP, honest about its limits):
// - One identity keypair per DEVICE, generated lazily on first use and kept
//   in localStorage. The private key never leaves this device.
// - The public key is published to the server (PUT /me/e2e-key); publishing
//   from a new device replaces it, so old history is unreadable there.
// - No per-message ratchet (no forward secrecy). For a corporate messenger
//   MVP this is a deliberate tradeoff, stated in the UI.
//
// Wire format (Message.content, contentType "e2e"):
//   e2e.v1.<nonce_base64>.<ciphertext_base64>
import nacl from "tweetnacl";
import { apiFetch } from "./api.js";

const STORAGE_KEY = "chatv2_e2e_keypair_v1";
const PREFIX = "e2e.v1.";

interface StoredKeyPair {
  publicKey: string; // base64
  secretKey: string; // base64
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function loadStoredKeyPair(): StoredKeyPair | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredKeyPair;
    if (!parsed.publicKey || !parsed.secretKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Returns this device's keypair, generating and persisting one on first use. */
export function getOrCreateKeyPair(): StoredKeyPair {
  const existing = loadStoredKeyPair();
  if (existing) return existing;
  const pair = nacl.box.keyPair();
  const stored: StoredKeyPair = {
    publicKey: toBase64(pair.publicKey),
    secretKey: toBase64(pair.secretKey)
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode: keys survive only this session. E2E still works.
  }
  return stored;
}

/**
 * Ensures the server knows this device's public key. Called once at app
 * boot (after login): if the published key differs from the local one
 * (fresh device or cleared storage), the local key is (re)published.
 */
export async function ensureKeyPublished(): Promise<void> {
  const pair = getOrCreateKeyPair();
  try {
    const { publicKey } = await apiFetch<{ publicKey: string | null }>("/me/e2e-key");
    if (publicKey !== pair.publicKey) {
      await apiFetch("/me/e2e-key", {
        method: "PUT",
        body: JSON.stringify({ publicKey: pair.publicKey })
      });
    }
  } catch {
    // Non-fatal: E2E enable flow will surface the error if it matters.
  }
}

/** Fetches channel members' public keys and returns the peer's (not mine). */
export async function fetchPeerPublicKey(channelId: string, myUserId: string): Promise<string | null> {
  const keys = await apiFetch<{ userId: string; publicKey: string | null }[]>(
    `/channels/${channelId}/e2e-keys`
  );
  const peer = keys.find((k) => k.userId !== myUserId);
  return peer?.publicKey ?? null;
}

/** Encrypts plaintext for the DM peer. Returns wire-format content. */
export function encryptForPeer(plaintext: string, peerPublicKeyB64: string): string {
  const pair = getOrCreateKeyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(
    new TextEncoder().encode(plaintext),
    nonce,
    fromBase64(peerPublicKeyB64),
    fromBase64(pair.secretKey)
  );
  return `${PREFIX}${toBase64(nonce)}.${toBase64(box)}`;
}

export function isE2eContent(content: string): boolean {
  return content.startsWith(PREFIX);
}

/**
 * Decrypts wire-format content using this device's secret key and the DM
 * peer's public key (works for own and peer messages alike thanks to the
 * symmetric ECDH shared secret). Returns null when undecryptable (missing
 * or rotated keys) so the UI can show an honest placeholder.
 */
export function decryptFromPeer(content: string, peerPublicKeyB64: string): string | null {
  if (!isE2eContent(content)) return content;
  const pair = loadStoredKeyPair();
  if (!pair) return null;
  const parts = content.slice(PREFIX.length).split(".");
  if (parts.length !== 2) return null;
  try {
    const opened = nacl.box.open(
      fromBase64(parts[1] as string),
      fromBase64(parts[0] as string),
      fromBase64(peerPublicKeyB64),
      fromBase64(pair.secretKey)
    );
    if (!opened) return null;
    return new TextDecoder().decode(opened);
  } catch {
    return null;
  }
}
