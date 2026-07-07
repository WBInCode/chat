import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SignJWT, jwtVerify, importPKCS8, importSPKI, type KeyLike } from "jose";
import { env } from "../config/env.js";

const ALG = "EdDSA";

let cachedPrivateKey: KeyLike | null = null;
let cachedPublicKey: KeyLike | null = null;

// Env-provided PEM may arrive with escaped "\n" sequences (common when pasting
// a multi-line key into a single-line env field); normalise them to real newlines.
function normalizePem(pem: string): string {
  return pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
}

async function loadPrivateKey(): Promise<KeyLike> {
  if (cachedPrivateKey) return cachedPrivateKey;
  const pem = env.JWT_PRIVATE_KEY
    ? normalizePem(env.JWT_PRIVATE_KEY)
    : readFileSync(resolve(env.JWT_PRIVATE_KEY_PATH), "utf8");
  cachedPrivateKey = await importPKCS8(pem, ALG);
  return cachedPrivateKey;
}

async function loadPublicKey(): Promise<KeyLike> {
  if (cachedPublicKey) return cachedPublicKey;
  const pem = env.JWT_PUBLIC_KEY
    ? normalizePem(env.JWT_PUBLIC_KEY)
    : readFileSync(resolve(env.JWT_PUBLIC_KEY_PATH), "utf8");
  cachedPublicKey = await importSPKI(pem, ALG);
  return cachedPublicKey;
}

export interface AccessTokenPayload {
  sub: string; // userId
  sid: string; // session id (Session.id) — allows immediate revocation checks
}

// Deliberately minimal: org/channel roles are NOT embedded in the token.
// They are resolved per-request from the DB (with Redis caching later),
// so role/membership changes take effect immediately instead of waiting
// for token expiry — important since a removed member must lose access
// right away, not after up to 10 minutes.
export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  const privateKey = await loadPrivateKey();
  return new SignJWT({ sid: payload.sid })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.sub)
    .setIssuer(env.JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_TTL)
    .sign(privateKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const publicKey = await loadPublicKey();
  const { payload } = await jwtVerify(token, publicKey, {
    issuer: env.JWT_ISSUER
  });

  if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
    throw new Error("Malformed token payload");
  }

  return {
    sub: payload.sub,
    sid: payload.sid
  };
}
