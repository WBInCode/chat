import { Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { WS_SERVER_EVENTS } from "@chatv2/shared";
import { queueConnection, VOICE_TIMEOUT_QUEUE, type VoiceTimeoutJobData } from "../lib/queue.js";
import { createMessageService } from "../modules/messages/service.js";

/**
 * Czy rozmowa ma zostać zamknięta po upływie okna oczekiwania.
 *
 * Kończymy tylko wtedy, gdy zakładający siedzi w pokoju sam. Pokoju z więcej
 * niż jedną osobą nie ruszamy, a pusty oznacza, że rozmowa już się skończyła
 * i drugi komunikat byłby tylko szumem.
 */
export function czyZakonczycRozmowe(uczestnicy: string[], starterId: string): boolean {
  return uczestnicy.length === 1 && uczestnicy[0] === starterId;
}

/**
 * Kończy rozmowę głosową, do której nikt nie dołączył. Zadanie planowane jest
 * przy zakładaniu pokoju i sprawdza po upływie okna, czy ktoś doszedł.
 */
export function registerVoiceTimeoutWorker(fastify: FastifyInstance) {
  const messages = createMessageService(fastify);

  const worker = new Worker<VoiceTimeoutJobData>(
    VOICE_TIMEOUT_QUEUE,
    async (job) => {
      const { channelId, starterId } = job.data;
      const usersKey = `voice:room:${channelId}:users`;
      const mutedKey = `voice:room:${channelId}:muted`;

      const uczestnicy = await fastify.redis.smembers(usersKey);
      if (!czyZakonczycRozmowe(uczestnicy, starterId)) return;

      // Usunięcie klucza przed wysłaniem komunikatu sprawia, że powtórzone
      // zadanie zastanie pusty pokój i nie napisze drugi raz tego samego.
      await fastify.redis.del(usersKey, mutedKey);

      fastify.io?.to(`voice:${channelId}`).emit(WS_SERVER_EVENTS.VoiceEnded, {
        channelId,
        reason: "no-answer"
      });
      fastify.io?.socketsLeave(`voice:${channelId}`);

      const wiadomosc = await messages.sendSystemMessage(
        channelId,
        starterId,
        "Rozmowa głosowa zakończona automatycznie: nikt nie dołączył przez 3 minuty"
      );
      fastify.io?.to(`channel:${channelId}`).emit(WS_SERVER_EVENTS.MessageNew, wiadomosc);
    },
    { connection: queueConnection, concurrency: 2 }
  );

  worker.on("failed", (job, err) => {
    fastify.log.error({ err, jobId: job?.id }, "Voice timeout job failed");
  });

  fastify.addHook("onClose", async () => {
    await worker.close();
  });
}
