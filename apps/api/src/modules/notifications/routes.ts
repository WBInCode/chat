import type { FastifyInstance } from "fastify";
import {
  setNotifyModeSchema,
  pushSubscribeSchema,
  pushUnsubscribeSchema
} from "@chatv2/shared";
import { parseOrThrow } from "../../lib/validation.js";
import { env } from "../../config/env.js";

/**
 * Web Push plumbing: publish the VAPID public key for the client to use
 * when subscribing, store/remove browser push subscriptions, and let users
 * pick their notification mode (all messages / mentions only / none).
 */
export default async function notificationRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/push/vapid-public-key", async () => {
    return { publicKey: env.VAPID_PUBLIC_KEY ?? null };
  });

  fastify.post("/me/push-subscribe", async (request, reply) => {
    const input = parseOrThrow(pushSubscribeSchema, request.body);
    await fastify.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId: request.user!.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth
      },
      update: { userId: request.user!.id, p256dh: input.keys.p256dh, auth: input.keys.auth }
    });
    return reply.status(201).send({ ok: true });
  });

  fastify.post("/me/push-unsubscribe", async (request, reply) => {
    const input = parseOrThrow(pushUnsubscribeSchema, request.body);
    await fastify.prisma.pushSubscription.deleteMany({
      where: { endpoint: input.endpoint, userId: request.user!.id }
    });
    return reply.status(204).send();
  });

  fastify.patch("/me/notification-preferences", async (request) => {
    const input = parseOrThrow(setNotifyModeSchema, request.body);
    const user = await fastify.prisma.user.update({
      where: { id: request.user!.id },
      data: { notifyMode: input.mode }
    });
    return { mode: user.notifyMode };
  });

  fastify.get("/me/notification-preferences", async (request) => {
    const user = await fastify.prisma.user.findUnique({ where: { id: request.user!.id } });
    return { mode: user?.notifyMode ?? "ALL" };
  });

  /**
   * Digest shown right after login/reconnect: how many unread mentions the
   * user has, and in how many channels — powers a single toast instead of
   * silently accumulating badges.
   */
  fastify.get("/me/unread-summary", async (request) => {
    const userId = request.user!.id;
    const memberships = await fastify.prisma.channelMember.findMany({
      where: { userId },
      include: { channel: { select: { id: true, orgId: true } } }
    });

    let totalUnread = 0;
    let mentionCount = 0;
    const channelsWithUnread = new Set<string>();

    for (const m of memberships) {
      if (m.mutedAt) continue;
      const lastRead = m.lastReadAt ?? new Date(0);
      const unread = await fastify.prisma.message.findMany({
        where: { channelId: m.channelId, authorId: { not: userId }, createdAt: { gt: lastRead }, deletedAt: null },
        select: { content: true }
      });
      if (unread.length === 0) continue;
      totalUnread += unread.length;
      channelsWithUnread.add(m.channelId);

      // Cheap heuristic: an @mention of the user's own display name.
      const user = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
      if (user) {
        mentionCount += unread.filter((msg) => msg.content.includes(`@${user.displayName}`)).length;
      }
    }

    return {
      totalUnread,
      mentionCount,
      channelCount: channelsWithUnread.size
    };
  });
}
