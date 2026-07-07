import { randomBytes } from "node:crypto";
import { authenticator } from "otplib";
import type { AuthRepo } from "./repo.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { encryptField, decryptField } from "../../lib/field-crypto.js";
import { signAccessToken } from "../../lib/jwt.js";
import { generateRefreshToken, generateFamilyId, hashToken } from "../../lib/tokens.js";
import { env } from "../../config/env.js";
import { revokeSession } from "../../plugins/auth-guard.js";
import type { FastifyInstance } from "fastify";

// Tolerate ±1 time-step (±30s) for clock skew between server and the user's
// authenticator device — standard TOTP practice (RFC 6238 §5.2).
authenticator.options = { window: 1 };

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

const REFRESH_COOKIE_NAME = "chatv2_rt";
const GENERIC_LOGIN_ERROR = "Nieprawidłowy email lub hasło";

export function createAuthService(fastify: FastifyInstance, repo: AuthRepo) {
  function refreshCookieOptions() {
    const isProd = env.NODE_ENV === "production";
    return {
      httpOnly: true,
      secure: isProd,
      // Cross-site (frontend i backend na różnych domenach, np. Vercel + Render)
      // wymaga SameSite=None; w dev zostaje Strict.
      sameSite: (isProd ? "none" : "strict") as "none" | "strict",
      path: "/api/v1/auth",
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60
    };
  }

  async function register(input: { email: string; password: string; displayName: string }) {
    const existing = await repo.findUserByEmail(input.email);
    if (existing) {
      // Do not leak which field conflicted; generic message + same shape as success path.
      throw new AuthError("EMAIL_TAKEN", "Nie można utworzyć konta z podanymi danymi");
    }

    const passwordHash = await hashPassword(input.password);
    const user = await repo.createUser({
      email: input.email,
      passwordHash,
      displayName: input.displayName
    });

    return user;
  }

  async function issueSession(userId: string, meta: { userAgent: string | null; ip: string | null }) {
    const refreshToken = generateRefreshToken();
    const familyId = generateFamilyId();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    const session = await repo.createSession({
      userId,
      refreshHash: hashToken(refreshToken),
      familyId,
      userAgent: meta.userAgent,
      ip: meta.ip,
      expiresAt
    });

    const accessToken = await signAccessToken({ sub: userId, sid: session.id });

    return { accessToken, refreshToken };
  }

  async function login(input: {
    email: string;
    password: string;
    totpCode?: string;
    userAgent: string | null;
    ip: string | null;
  }) {
    const user = await repo.findUserByEmail(input.email);
    if (!user) {
      // Constant-shape failure: run a dummy hash to keep timing similar to
      // the "wrong password" branch, avoiding user-enumeration via timing.
      await verifyPassword(
        "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        input.password
      );
      throw new AuthError("INVALID_CREDENTIALS", GENERIC_LOGIN_ERROR);
    }

    const passwordOk = await verifyPassword(user.passwordHash, input.password);
    if (!passwordOk) {
      throw new AuthError("INVALID_CREDENTIALS", GENERIC_LOGIN_ERROR);
    }

    if (user.totpEnabled) {
      if (!input.totpCode) {
        throw new AuthError("TOTP_REQUIRED", "Wymagany kod 2FA");
      }
      if (!user.totpSecret) {
        throw new AuthError("INVALID_CREDENTIALS", GENERIC_LOGIN_ERROR);
      }
      const secret = decryptField(user.totpSecret);
      const valid = authenticator.check(input.totpCode, secret);
      if (!valid) {
        throw new AuthError("INVALID_TOTP", "Nieprawidłowy kod 2FA");
      }
    }

    const { accessToken, refreshToken } = await issueSession(user.id, {
      userAgent: input.userAgent,
      ip: input.ip
    });

    return {
      accessToken,
      refreshToken,
      cookieOptions: refreshCookieOptions(),
      user
    };
  }

  /**
   * Refresh token rotation with reuse detection (per PLAN.md §6.1):
   * every refresh consumes the old token and issues a new one from the
   * same "family". If an already-used/revoked token is presented again,
   * that's a signal of token theft — the entire family is revoked,
   * forcing re-authentication on all devices sharing that lineage.
   */
  async function refresh(refreshToken: string, meta: { userAgent: string | null; ip: string | null }) {
    const presentedHash = hashToken(refreshToken);
    const session = await repo.findSessionByRefreshHash(presentedHash);

    if (!session) {
      throw new AuthError("INVALID_REFRESH", "Sesja wygasła, zaloguj się ponownie");
    }

    if (session.revokedAt || session.expiresAt < new Date()) {
      await repo.revokeSessionFamily(session.familyId);
      throw new AuthError("REFRESH_REUSE_DETECTED", "Wykryto podejrzaną aktywność sesji");
    }

    await repo.revokeSession(session.id);

    const newRefreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    const newSession = await repo.createSession({
      userId: session.userId,
      refreshHash: hashToken(newRefreshToken),
      familyId: session.familyId,
      userAgent: meta.userAgent,
      ip: meta.ip,
      expiresAt
    });

    const accessToken = await signAccessToken({ sub: session.userId, sid: newSession.id });

    return { accessToken, refreshToken: newRefreshToken, cookieOptions: refreshCookieOptions() };
  }

  async function logout(refreshToken: string | undefined, sessionId: string | undefined) {
    if (refreshToken) {
      const session = await repo.findSessionByRefreshHash(hashToken(refreshToken));
      if (session) {
        await repo.revokeSession(session.id);
      }
    }
    if (sessionId) {
      await revokeSession(fastify, sessionId, env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60);
    }
  }

  async function setupTotp(userId: string) {
    const user = await repo.findUserById(userId);
    if (!user) throw new AuthError("NOT_FOUND", "Użytkownik nie istnieje");

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, env.JWT_ISSUER, secret);

    // Store pending secret encrypted; not yet enabled until verified via verifyTotpSetup.
    await repo.setPendingTotpSecret(userId, encryptField(secret));

    return { otpauthUrl, secret };
  }

  async function verifyTotpSetup(userId: string, code: string) {
    const user = await repo.findUserById(userId);
    if (!user?.totpSecret) {
      throw new AuthError("NOT_FOUND", "Najpierw zainicjuj konfigurację 2FA");
    }
    const secret = decryptField(user.totpSecret);
    const valid = authenticator.check(code, secret);
    if (!valid) {
      throw new AuthError("INVALID_TOTP", "Nieprawidłowy kod 2FA");
    }

    await repo.confirmTotpEnabled(userId);

    const codes = Array.from({ length: 10 }, () => randomBytes(5).toString("hex"));
    const codeHashes = codes.map((c) => hashToken(c));
    await repo.createRecoveryCodes(userId, codeHashes);

    return { recoveryCodes: codes };
  }

  return {
    register,
    login,
    refresh,
    logout,
    setupTotp,
    verifyTotpSetup,
    REFRESH_COOKIE_NAME,
    refreshCookieOptions
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
