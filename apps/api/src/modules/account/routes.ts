import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { deleteAccountSchema } from "@chatv2/shared";
import { parseOrThrow } from "../../lib/validation.js";
import { logAudit } from "../../lib/audit.js";
import { revokeSession } from "../../plugins/auth-guard.js";

/**
 * Self-service account deletion. Anonymizes the user row in place rather
 * than deleting it outright — past messages authored by the user must
 * remain intact for other members' conversation history (and for audit
 * trail integrity), so we scrub personally-identifying fields instead of
 * cascading a hard delete.
 */
export default async function accountRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.delete("/me", async (request, reply) => {
    parseOrThrow(deleteAccountSchema, request.body);
    const userId = request.user!.id;

    const memberships = await fastify.prisma.membership.findMany({ where: { userId } });
    const sessions = await fastify.prisma.session.findMany({ where: { userId, revokedAt: null } });

    const anonEmail = `deleted-${userId}@deleted.local`;
    await fastify.prisma.user.update({
      where: { id: userId },
      data: {
        email: anonEmail,
        displayName: "Użytkownik usunięty",
        avatarUrl: null,
        passwordHash: randomBytes(32).toString("hex"), // unusable — login is now impossible
        totpSecret: null,
        totpEnabled: false,
        publicKey: null,
        deletedAt: new Date()
      }
    });

    await fastify.prisma.recoveryCode.deleteMany({ where: { userId } });
    await fastify.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await Promise.all(sessions.map((s) => revokeSession(fastify, s.id, 60 * 60 * 24 * 14)));

    for (const m of memberships) {
      await logAudit(fastify, {
        orgId: m.orgId,
        actorId: userId,
        action: "account.self_deleted",
        meta: {},
        ip: request.ip
      });
    }

    return reply.send({ ok: true });
  });
}
