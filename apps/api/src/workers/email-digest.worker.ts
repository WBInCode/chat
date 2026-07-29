import { Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { queueConnection, EMAIL_DIGEST_QUEUE, type EmailDigestJobData } from "../lib/queue.js";
import { isMailConfigured, sendMail } from "../lib/mailer.js";
import { buildDigestChannels } from "../lib/digest-builder.js";
import {
  applyCooldown,
  drainBuffer,
  releasePending,
  resetEscalation,
  restoreBuffer,
  withinDailyCap
} from "../lib/email-digest.js";
import { digestSubject, renderDigestHtml, renderDigestText } from "../lib/email-templates.js";

/**
 * Wysyła jedno zbiorcze powiadomienie dla jednej osoby.
 *
 * Cała decyzja "czy w ogóle wysyłać" zapada tutaj, a nie w chwili nadejścia
 * wiadomości. To jest istota mechanizmu: między zebraniem wiadomości a
 * wysyłką mija kilka minut, w których odbiorca mógł wrócić do aplikacji,
 * przeczytać kanał, wyciszyć go albo zmienić ustawienia. W każdym z tych
 * przypadków mail jest zbędny i nie powstaje.
 */
export function registerEmailDigestWorker(fastify: FastifyInstance) {
  const worker = new Worker<EmailDigestJobData>(
    EMAIL_DIGEST_QUEUE,
    async (job) => {
      const { userId } = job.data;
      await releasePending(fastify, userId);
      if (!isMailConfigured()) return;

      const items = await drainBuffer(fastify, userId);
      if (items.length === 0) {
        await resetEscalation(fastify, userId);
        return;
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, displayName: true, emailDigest: true, deletedAt: true }
      });
      if (!user || user.deletedAt || user.emailDigest === "OFF") {
        await resetEscalation(fastify, userId);
        return;
      }

      // Osoba ma otwartą aplikację (dowolny status obecności oznacza żywe
      // połączenie) — zobaczy wiadomości na miejscu, mail byłby zbędnym
      // dublem. Bufor przepada celowo: gdy zaraz potem zamknie kartę,
      // kolejne wiadomości uruchomią nową serię.
      const presence = await fastify.redis.get(`presence:${userId}`);
      if (presence) {
        await resetEscalation(fastify, userId);
        return;
      }

      const relevant = user.emailDigest === "MENTIONS" ? items.filter((i) => i.mention) : items;
      if (relevant.length === 0) {
        await resetEscalation(fastify, userId);
        return;
      }

      const channels = await buildDigestChannels(fastify, userId, relevant);
      const total = channels.reduce((sum, c) => sum + c.messages.length + c.omitted, 0);
      if (channels.length === 0 || total === 0) {
        // Wszystko przeczytane albo usunięte w międzyczasie.
        await resetEscalation(fastify, userId);
        return;
      }

      if (!(await withinDailyCap(fastify, userId, env.MAIL_DAILY_LIMIT_PER_USER))) {
        fastify.log.warn({ userId }, "Dzienny limit e-maili osiągnięty, pomijam podsumowanie");
        return;
      }

      const sent = await sendMail(fastify.log, {
        to: user.email,
        subject: digestSubject(channels, total),
        html: renderDigestHtml(user.displayName, channels, total),
        text: renderDigestText(user.displayName, channels, total),
        // Jeden wątek na rozmowę, gdy podsumowanie dotyczy jednego kanału.
        ...(channels.length === 1 ? { threadKey: `channel-${channels[0]!.channelId}` } : {})
      });

      if (!sent) {
        // Awaria SMTP: wpisy wracają do bufora, żeby ponowienie zadania
        // wysłało je razem, zamiast zgubić powiadomienie.
        await restoreBuffer(fastify, userId, relevant);
        throw new Error("Nie udało się wysłać podsumowania");
      }

      const cooldown = await applyCooldown(fastify, userId);
      fastify.log.info(
        { userId, messages: total, channels: channels.length, nextInMs: cooldown },
        "Wysłano zbiorcze powiadomienie e-mail"
      );
    },
    { connection: queueConnection, concurrency: 3 }
  );

  worker.on("failed", (job, err) => {
    fastify.log.warn({ err, userId: job?.data.userId }, "Zadanie podsumowania e-mail nie powiodło się");
  });

  fastify.addHook("onClose", async () => {
    await worker.close();
  });

  return worker;
}
