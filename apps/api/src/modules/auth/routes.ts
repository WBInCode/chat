import type { FastifyInstance } from "fastify";
import {
  registerSchema,
  loginSchema,
  totpVerifySchema
} from "@chatv2/shared";
import { createAuthRepo } from "./repo.js";
import { createAuthService, AuthError } from "./service.js";
import { parseOrThrow, ValidationError, sendError } from "../../lib/validation.js";
import { hashToken } from "../../lib/tokens.js";
import { env } from "../../config/env.js";

export default async function authRoutes(fastify: FastifyInstance) {
  const repo = createAuthRepo(fastify.prisma);
  const service = createAuthService(fastify, repo);

  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof ValidationError) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Nieprawidłowe dane wejściowe");
    }
    if (error instanceof AuthError) {
      // Błędy sesji muszą być 401, nie 400: klient odróżnia po statusie
      // "trzeba się zalogować" od "coś jest nie tak z żądaniem", a w logach
      // proxy wygasła sesja wyglądała dotąd jak błąd walidacji.
      const unauthorized = new Set([
        "TOTP_REQUIRED",
        "INVALID_CREDENTIALS",
        "INVALID_TOTP",
        "INVALID_REFRESH",
        "SESSION_EXPIRED",
        "REFRESH_REUSE_DETECTED"
      ]);
      const status = unauthorized.has(error.code) ? 401 : error.code === "EMAIL_TAKEN" ? 409 : 400;
      return sendError(reply, status, error.code, error.message);
    }
    throw error;
  });

  fastify.post(
    "/register",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "15 minutes" }
      }
    },
    async (request, reply) => {
      if (env.AUTH_SSO_ONLY) {
        return sendError(reply, 403, "SSO_ONLY", "Rejestracja lokalna wyłączona — zaloguj się przez WB Platform.");
      }
      const input = parseOrThrow(registerSchema, request.body);
      const user = await service.register(input);
      return reply.status(201).send({
        user: { id: user.id, email: user.email, displayName: user.displayName }
      });
    }
  );

  fastify.post(
    "/login",
    {
      config: {
        // Brute-force guard: 5 attempts / 15 min, keyed per IP+email so one
        // bad actor can't lock out other users, and one account can't be
        // hammered from many IPs beyond the global limit either.
        rateLimit: {
          max: 5,
          timeWindow: "15 minutes",
          keyGenerator: (req) => {
            const body = req.body as { email?: string } | undefined;
            return `${req.ip}:${body?.email ?? "unknown"}`;
          }
        }
      }
    },
    async (request, reply) => {
      if (env.AUTH_SSO_ONLY) {
        return sendError(reply, 403, "SSO_ONLY", "Logowanie lokalne wyłączone — zaloguj się przez WB Platform.");
      }
      const input = parseOrThrow(loginSchema, request.body);
      const result = await service.login({
        email: input.email,
        password: input.password,
        ...(input.totpCode ? { totpCode: input.totpCode } : {}),
        userAgent: request.headers["user-agent"] ?? null,
        ip: request.ip
      });

      reply.setCookie(service.REFRESH_COOKIE_NAME, result.refreshToken, result.cookieOptions);

      return reply.send({
        accessToken: result.accessToken,
        user: {
          id: result.user.id,
          email: result.user.email,
          displayName: result.user.displayName,
          isSuperAdmin: result.user.isSuperAdmin
        }
      });
    }
  );

  fastify.post(
    "/refresh",
    {
      config: {
        // Odnawianie sesji dzieliło globalny budżet 300 żądań/min liczony na
        // adres IP z całym pozostałym ruchem. Całe biuro siedzi za jednym NAT-em,
        // więc w godzinach szczytu limiter odrzucał ludziom odświeżenie sesji
        // i wylogowywał ich za cudzy ruch. Klucz to sam token odświeżający,
        // czyli limit działa na sesję, nie na biuro.
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
          // Skrót, nie surowy token: klucz limitera ląduje w nazwie klucza
          // Redisa, a tam sekret nie ma czego szukać.
          keyGenerator: (req: { cookies: Record<string, string | undefined>; ip: string }) => {
            const rt = req.cookies[service.REFRESH_COOKIE_NAME];
            return rt ? `rt:${hashToken(rt)}` : `ip:${req.ip}`;
          }
        }
      }
    },
    async (request, reply) => {
      const refreshToken = request.cookies[service.REFRESH_COOKIE_NAME];
      if (!refreshToken) {
        return sendError(reply, 401, "NO_REFRESH_TOKEN", "Brak tokenu odświeżającego");
      }

      const result = await service.refresh(refreshToken, {
        userAgent: request.headers["user-agent"] ?? null,
        ip: request.ip
      });

      reply.setCookie(service.REFRESH_COOKIE_NAME, result.refreshToken, result.cookieOptions);
      return reply.send({ accessToken: result.accessToken });
    }
  );

  fastify.post("/logout", async (request, reply) => {
    const refreshToken = request.cookies[service.REFRESH_COOKIE_NAME];
    await service.logout(refreshToken, request.user?.sessionId);
    reply.clearCookie(service.REFRESH_COOKIE_NAME, { path: "/api/v1/auth" });
    return reply.status(204).send();
  });

  fastify.get("/me", { preHandler: fastify.authenticate }, async (request, reply) => {
    const user = await repo.findUserById(request.user!.id);
    if (!user) return sendError(reply, 404, "NOT_FOUND", "Użytkownik nie istnieje");
    return reply.send({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      totpEnabled: user.totpEnabled,
      isSuperAdmin: user.isSuperAdmin
    });
  });

  fastify.post("/2fa/setup", { preHandler: fastify.authenticate }, async (request, reply) => {
    const result = await service.setupTotp(request.user!.id);
    return reply.send(result);
  });

  fastify.post("/2fa/verify", { preHandler: fastify.authenticate }, async (request, reply) => {
    const input = parseOrThrow(totpVerifySchema, request.body);
    const result = await service.verifyTotpSetup(request.user!.id, input.code);
    return reply.send(result);
  });
}
