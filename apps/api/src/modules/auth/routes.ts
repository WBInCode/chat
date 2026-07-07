import type { FastifyInstance } from "fastify";
import {
  registerSchema,
  loginSchema,
  totpVerifySchema
} from "@chatv2/shared";
import { createAuthRepo } from "./repo.js";
import { createAuthService, AuthError } from "./service.js";
import { parseOrThrow, ValidationError, sendError } from "../../lib/validation.js";

export default async function authRoutes(fastify: FastifyInstance) {
  const repo = createAuthRepo(fastify.prisma);
  const service = createAuthService(fastify, repo);

  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof ValidationError) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Nieprawidłowe dane wejściowe");
    }
    if (error instanceof AuthError) {
      const status =
        error.code === "TOTP_REQUIRED"
          ? 401
          : error.code === "INVALID_CREDENTIALS" || error.code === "INVALID_TOTP"
            ? 401
            : error.code === "EMAIL_TAKEN"
              ? 409
              : 400;
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

  fastify.post("/refresh", async (request, reply) => {
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
  });

  fastify.post("/logout", { preHandler: fastify.authenticate }, async (request, reply) => {
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
