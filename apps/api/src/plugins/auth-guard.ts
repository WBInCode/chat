import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "../lib/jwt.js";

export interface AuthenticatedUser {
  id: string;
  sessionId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const REVOKED_SESSION_PREFIX = "revoked-session:";

export default fp(async function authGuardPlugin(fastify: FastifyInstance) {
  fastify.decorate(
    "authenticate",
    async function authenticate(request: FastifyRequest, reply: FastifyReply) {
      const header = request.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        return reply.unauthorized("Brak tokenu uwierzytelniającego");
      }

      const token = header.slice("Bearer ".length);

      try {
        const payload = await verifyAccessToken(token);

        const isRevoked = await fastify.redis.get(`${REVOKED_SESSION_PREFIX}${payload.sid}`);
        if (isRevoked) {
          return reply.unauthorized("Sesja została unieważniona");
        }

        request.user = { id: payload.sub, sessionId: payload.sid };
      } catch {
        return reply.unauthorized("Nieprawidłowy lub wygasły token");
      }
    }
  );
});

export async function revokeSession(fastify: FastifyInstance, sessionId: string, ttlSeconds: number) {
  await fastify.redis.set(`${REVOKED_SESSION_PREFIX}${sessionId}`, "1", "EX", ttlSeconds);
}
