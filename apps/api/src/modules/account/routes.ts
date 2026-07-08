import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { deleteAccountSchema } from "@chatv2/shared";
import { parseOrThrow } from "../../lib/validation.js";
import { logAudit } from "../../lib/audit.js";
import { revokeSession } from "../../plugins/auth-guard.js";
import { s3 } from "../../lib/s3.js";
import { env } from "../../config/env.js";

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

    const existing = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { avatarKey: true } });
    if (existing?.avatarKey) {
      await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: existing.avatarKey })).catch(() => {});
    }

    const anonEmail = `deleted-${userId}@deleted.local`;
    await fastify.prisma.user.update({
      where: { id: userId },
      data: {
        email: anonEmail,
        displayName: "Użytkownik usunięty",
        avatarUrl: null,
        avatarKey: null,
        jobTitle: null,
        department: null,
        phone: null,
        statusText: null,
        statusEmoji: null,
        statusExpiresAt: null,
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

  // ── Active sessions (F6-E) ───────────────────────────────────────────
  /** List the user's active (non-revoked, non-expired) sessions/devices. */
  fastify.get("/me/sessions", async (request) => {
    const userId = request.user!.id;
    const sessions = await fastify.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, userAgent: true, ip: true, createdAt: true, expiresAt: true }
    });
    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === request.user!.sessionId
    }));
  });

  /** Revoke a single session (remote logout of one device). */
  fastify.delete("/me/sessions/:sessionId", async (request, reply) => {
    const userId = request.user!.id;
    const { sessionId } = request.params as { sessionId: string };
    const session = await fastify.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      return reply.notFound("Sesja nie istnieje");
    }
    if (!session.revokedAt) {
      await fastify.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
      await revokeSession(fastify, sessionId, env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60);
    }
    return reply.send({ ok: true });
  });

  /** Revoke every session except the current one ("log out everywhere else"). */
  fastify.post("/me/sessions/revoke-others", async (request, reply) => {
    const userId = request.user!.id;
    const current = request.user!.sessionId;
    const others = await fastify.prisma.session.findMany({
      where: { userId, revokedAt: null, id: { not: current } },
      select: { id: true }
    });
    await fastify.prisma.session.updateMany({
      where: { userId, revokedAt: null, id: { not: current } },
      data: { revokedAt: new Date() }
    });
    await Promise.all(
      others.map((s) => revokeSession(fastify, s.id, env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60))
    );
    return reply.send({ ok: true, revoked: others.length });
  });
}
