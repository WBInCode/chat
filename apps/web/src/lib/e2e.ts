// End-to-end encryption for 1:1 DMs (opt-in per conversation).
//
// THREAT MODEL (what this actually defends against):
//   - Network attacker .................... yes (TLS + E2E)
//   - Stolen database dump ................ yes (server only ever holds ciphertext)
//   - Malicious / compelled SERVER ........ yes, as long as the user checks the
//     safety number. The server never sees plaintext, and it cannot silently
//     swap a peer's key: keys are pinned on first contact (TOFU) and any later
//     change hard-blocks the conversation until the user re-verifies.
//   - Compromised DEVICE .................. no. Whoever holds the identity
//     private key reads that device's history. See "no forward secrecy" below.
//
// Crypto:
//   - Identity keypair: X25519, one per device, generated locally.
//   - Message sealing: NaCl box = X25519 ECDH + XSalsa20-Poly1305 (tweetnacl,
//     audited, dependency-free). Authenticated (AEAD), so tampered ciphertext
//     fails to open rather than decrypting to garbage.
//   - Length hiding: plaintext is padded into fixed buckets before sealing so
//     the stored ciphertext size does not leak the real message length.
//
// KNOWN LIMIT - no forward secrecy. There is one long-lived key per device,
// not a per-message ratchet. If an identity private key is ever extracted from
// a device, past messages readable by that device stay readable. Closing this
// requires one-time prekeys plus a local decrypted-message store (the server
// only keeps ciphertext, so history is re-fetched and re-decrypted on every
// load today). That is an architectural change, deliberately not faked here.
//
// Wire format (Message.content, contentType "e2e"):
//   v2:  e2e.v2.<nonce_b64>.<ciphertext_b64>   (padded plaintext)
//   v1:  e2e.v1.<nonce_b64>.<ciphertext_b64>   (legacy, unpadded; still read)
import nacl from "tweetnacl";
import { apiFetch } from "./api.js";

const STORAGE_KEY = "chatv2_e2e_keypair_v1";
const PINS_KEY = "chatv2_e2e_pinned_keys_v1";
const PREFIX_V1 = "e2e.v1.";
const PREFIX_V2 = "e2e.v2.";

interface StoredKeyPair {
  publicKey: string; // base64
  secretKey: string; // base64
}

/** A peer's key as this device first saw it (trust-on-first-use). */
interface PinnedKey {
  publicKey: string;
  pinnedAt: string;
}

export type PeerKeyStatus =
  | { state: "ok"; peerUserId: string; publicKey: string; safetyNumber: string; firstUse: boolean }
  | {
      state: "changed";
      peerUserId: string;
      publicKey: string;
      pinnedPublicKey: string;
      safetyNumber: string;
    }
  | { state: "missing" };

// ── encoding helpers ─────────────────────────────────────────────────────
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

// ── identity key ─────────────────────────────────────────────────────────
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

// ── key pinning (TOFU) ───────────────────────────────────────────────────
// The server hands out peer public keys, so on its own it could hand out a
// key it controls and transparently read everything. Pinning turns that from
// an invisible attack into a visible one: the key is remembered the first
// time it is seen, and any later change stops the conversation dead until the
// user re-verifies out of band.
function loadPins(): Record<string, PinnedKey> {
  try {
    return JSON.parse(localStorage.getItem(PINS_KEY) ?? "{}") as Record<string, PinnedKey>;
  } catch {
    return {};
  }
}

function savePins(pins: Record<string, PinnedKey>) {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    // Storage unavailable: pinning degrades to per-session only.
  }
}

/**
 * Safety number: a fingerprint of BOTH identity keys that two people can read
 * out to each other (call, in person) to confirm nobody is in the middle.
 * Keys are sorted so both sides compute the identical value. Rendered as
 * 12 groups of 5 digits, the same shape Signal uses.
 */
export function computeSafetyNumber(myPublicKeyB64: string, peerPublicKeyB64: string): string {
  const [a, b] = [myPublicKeyB64, peerPublicKeyB64].sort();
  const digest = nacl.hash(new TextEncoder().encode(`chatv2-safety-v1:${a}:${b}`));
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    // Two bytes -> one 5-digit group keeps the mapping uniform and stable.
    const n = ((digest[i * 2]! << 8) | digest[i * 2 + 1]!) % 100000;
    groups.push(String(n).padStart(5, "0"));
  }
  return groups.join(" ");
}

/** Marks the currently served key as trusted (first use, or after a reviewed change). */
export function trustPeerKey(peerUserId: string, publicKey: string) {
  const pins = loadPins();
  pins[peerUserId] = { publicKey, pinnedAt: new Date().toISOString() };
  savePins(pins);
}

export function getPinnedKey(peerUserId: string): PinnedKey | null {
  return loadPins()[peerUserId] ?? null;
}

/**
 * Fetches the DM peer's key from the server and checks it against the pin.
 *
 * - "missing": peer has not published a key yet.
 * - "ok": matches the pin (or is being pinned right now, firstUse=true).
 * - "changed": the server served a DIFFERENT key than the pinned one. Either
 *   the peer reinstalled/switched device, or someone is attempting to read
 *   the conversation. The UI must block sending until the user decides.
 */
export async function checkPeerKey(channelId: string, myUserId: string): Promise<PeerKeyStatus> {
  const keys = await apiFetch<{ userId: string; publicKey: string | null }[]>(
    `/channels/${channelId}/e2e-keys`
  );
  const peer = keys.find((k) => k.userId !== myUserId);
  if (!peer?.publicKey) return { state: "missing" };

  const mine = getOrCreateKeyPair().publicKey;
  const safetyNumber = computeSafetyNumber(mine, peer.publicKey);
  const pinned = getPinnedKey(peer.userId);

  if (!pinned) {
    trustPeerKey(peer.userId, peer.publicKey);
    return {
      state: "ok",
      peerUserId: peer.userId,
      publicKey: peer.publicKey,
      safetyNumber,
      firstUse: true
    };
  }
  if (pinned.publicKey !== peer.publicKey) {
    return {
      state: "changed",
      peerUserId: peer.userId,
      publicKey: peer.publicKey,
      pinnedPublicKey: pinned.publicKey,
      safetyNumber
    };
  }
  return {
    state: "ok",
    peerUserId: peer.userId,
    publicKey: peer.publicKey,
    safetyNumber,
    firstUse: false
  };
}

// ── length padding ───────────────────────────────────────────────────────
// Ciphertext length otherwise mirrors plaintext length, which leaks a
// surprising amount to anyone holding the database ("ok" vs. a paragraph, a
// repeated fixed-size payload, etc.). Padding into buckets collapses that
// signal: every short message looks identical on disk.
const PAD_BUCKETS = [64, 256, 1024, 4096, 16384, 32000];

function pad(plainBytes: Uint8Array): Uint8Array {
  const needed = plainBytes.length + 4;
  const bucket = PAD_BUCKETS.find((b) => b >= needed) ?? needed;
  const out = new Uint8Array(bucket);
  // 4-byte big-endian real length, then the message, then random filler.
  new DataView(out.buffer).setUint32(0, plainBytes.length);
  out.set(plainBytes, 4);
  if (bucket > needed) out.set(nacl.randomBytes(bucket - needed), needed);
  return out;
}

function unpad(padded: Uint8Array): Uint8Array | null {
  if (padded.length < 4) return null;
  const len = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0);
  if (len > padded.length - 4) return null;
  return padded.subarray(4, 4 + len);
}

// ── seal / open ──────────────────────────────────────────────────────────
/** Encrypts (and length-pads) plaintext for the DM peer. Returns wire-format content. */
export function encryptForPeer(plaintext: string, peerPublicKeyB64: string): string {
  const pair = getOrCreateKeyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(
    pad(new TextEncoder().encode(plaintext)),
    nonce,
    fromBase64(peerPublicKeyB64),
    fromBase64(pair.secretKey)
  );
  return `${PREFIX_V2}${toBase64(nonce)}.${toBase64(box)}`;
}

export function isE2eContent(content: string): boolean {
  return content.startsWith(PREFIX_V1) || content.startsWith(PREFIX_V2);
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
  const padded = content.startsWith(PREFIX_V2);
  const parts = content.slice((padded ? PREFIX_V2 : PREFIX_V1).length).split(".");
  if (parts.length !== 2) return null;
  try {
    const opened = nacl.box.open(
      fromBase64(parts[1] as string),
      fromBase64(parts[0] as string),
      fromBase64(peerPublicKeyB64),
      fromBase64(pair.secretKey)
    );
    if (!opened) return null;
    const body = padded ? unpad(opened) : opened;
    if (!body) return null;
    return new TextDecoder().decode(body);
  } catch {
    return null;
  }
}

// ── device migration ─────────────────────────────────────────────────────
// Without this, turning E2E on means "my history dies with this browser
// profile", which in practice stops people from enabling it at all. The
// export is the raw private key, so it is treated like a password: shown
// once, copied by the user, never sent anywhere.
export function exportIdentityKey(): string {
  const pair = getOrCreateKeyPair();
  return `chatv2-e2e-key-v1:${pair.secretKey}`;
}

/**
 * Replaces this device's identity with a previously exported one. Pins are
 * cleared: they were made by the old identity, and safety numbers change
 * with the key, so every peer must be re-verified.
 */
export function importIdentityKey(exported: string): { ok: true } | { ok: false; error: string } {
  const trimmed = exported.trim();
  const prefix = "chatv2-e2e-key-v1:";
  if (!trimmed.startsWith(prefix)) return { ok: false, error: "Nieprawidłowy format klucza" };
  const secretB64 = trimmed.slice(prefix.length);
  let secret: Uint8Array;
  try {
    secret = fromBase64(secretB64);
  } catch {
    return { ok: false, error: "Nieprawidłowy format klucza" };
  }
  if (secret.length !== nacl.box.secretKeyLength) {
    return { ok: false, error: "Nieprawidłowa długość klucza" };
  }
  const pair = nacl.box.keyPair.fromSecretKey(secret);
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ publicKey: toBase64(pair.publicKey), secretKey: secretB64 })
    );
    localStorage.removeItem(PINS_KEY);
  } catch {
    return { ok: false, error: "Przeglądarka zablokowała zapis klucza" };
  }
  return { ok: true };
}
