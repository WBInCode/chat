import webPush from "web-push";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  webPush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  channelId: string;
  messageId: string;
  icon?: string;
}

/**
 * Best-effort Web Push fan-out to every subscription a user has registered
 * (multiple browsers/devices). Expired/invalid subscriptions (410/404 from
 * the push service) are pruned automatically. Never throws — notification
 * delivery must not block message sending.
 */
export async function sendPushToUser(fastify: FastifyInstance, userId: string, payload: PushPayload) {
  ensureConfigured();
  if (!configured) return; // VAPID not configured in this environment — no-op

  const subscriptions = await fastify.prisma.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webPush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await fastify.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          fastify.log.warn({ err, userId }, "Push notification failed");
        }
      }
    })
  );
}
