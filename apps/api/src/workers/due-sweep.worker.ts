import { Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { queueConnection, DUE_SWEEP_QUEUE } from "../lib/queue.js";
import { sendPushToUser } from "../lib/push.js";
import { createMessageService } from "../modules/messages/service.js";
import { WS_SERVER_EVENTS } from "@chatv2/shared";

/**
 * Runs every minute (see scheduleDueSweep): sends any scheduled messages
 * whose time has come, fires due reminders as push notifications, and
 * clears expired custom statuses. All three are simple "due <= now" sweeps
 * — cheap enough to share one recurring job instead of one timer per row.
 */
export function registerDueSweepWorker(fastify: FastifyInstance) {
  const messages = createMessageService(fastify);

  const worker = new Worker(
    DUE_SWEEP_QUEUE,
    async () => {
      const now = new Date();

      // ── scheduled messages ("send later") ──────────────────────────
      const due = await fastify.prisma.scheduledMessage.findMany({
        where: { sentAt: null, sendAt: { lte: now } }
      });
      for (const sm of due) {
        try {
          const message = await messages.sendMessage(sm.authorId, sm.channelId, sm.content);
          fastify.io?.to(`channel:${sm.channelId}`).emit(WS_SERVER_EVENTS.MessageNew, message);
          await fastify.prisma.scheduledMessage.update({ where: { id: sm.id }, data: { sentAt: now } });
        } catch (err) {
          fastify.log.warn({ err, scheduledMessageId: sm.id }, "Failed to send scheduled message");
        }
      }

      // ── reminders ───────────────────────────────────────────────────
      const dueReminders = await fastify.prisma.reminder.findMany({
        where: { sentAt: null, remindAt: { lte: now } }
      });
      for (const r of dueReminders) {
        try {
          const message = await fastify.prisma.message.findUnique({ where: { id: r.messageId } });
          await sendPushToUser(fastify, r.userId, {
            title: "⏰ Przypomnienie",
            body: r.note || message?.content?.slice(0, 120) || "Przypomnienie o wiadomości",
            channelId: r.channelId,
            messageId: r.messageId
          });
          await fastify.prisma.reminder.update({ where: { id: r.id }, data: { sentAt: now } });
        } catch (err) {
          fastify.log.warn({ err, reminderId: r.id }, "Failed to fire reminder");
        }
      }

      // ── auto-expiring custom status ────────────────────────────────
      await fastify.prisma.user.updateMany({
        where: { statusExpiresAt: { lte: now } },
        data: { statusText: null, statusEmoji: null, statusExpiresAt: null }
      });
    },
    { connection: queueConnection, concurrency: 1 }
  );

  fastify.addHook("onClose", async () => {
    await worker.close();
  });

  return worker;
}
