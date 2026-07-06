import { Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "../lib/s3.js";
import { env } from "../config/env.js";
import { queueConnection, RETENTION_PURGE_QUEUE } from "../lib/queue.js";
import { logAudit } from "../lib/audit.js";

/**
 * Daily job: for every org with `messageRetentionDays` configured, hard-
 * deletes messages (and their S3 files) older than the retention window.
 * Runs org-by-org so a failure in one org doesn't block the rest.
 */
export function registerRetentionPurgeWorker(fastify: FastifyInstance) {
  const worker = new Worker(
    RETENTION_PURGE_QUEUE,
    async () => {
      const orgs = await fastify.prisma.organization.findMany({
        where: { messageRetentionDays: { not: null } },
        select: { id: true, messageRetentionDays: true }
      });

      for (const org of orgs) {
        const cutoff = new Date(Date.now() - org.messageRetentionDays! * 24 * 60 * 60 * 1000);
        try {
          const staleMessages = await fastify.prisma.message.findMany({
            where: { channel: { orgId: org.id }, createdAt: { lt: cutoff } },
            select: { id: true, files: { select: { id: true, key: true, thumbKey: true } } }
          });
          if (staleMessages.length === 0) continue;

          const fileDeletions = staleMessages.flatMap((m) =>
            m.files.flatMap((f) => [
              s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: f.key })),
              f.thumbKey
                ? s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: f.thumbKey }))
                : Promise.resolve()
            ])
          );
          await Promise.allSettled(fileDeletions);

          const messageIds = staleMessages.map((m) => m.id);
          await fastify.prisma.message.deleteMany({ where: { id: { in: messageIds } } });

          await logAudit(fastify, {
            orgId: org.id,
            actorId: null,
            action: "retention.purge",
            meta: { purgedCount: messageIds.length, cutoff: cutoff.toISOString() },
            ip: null
          });

          fastify.log.info({ orgId: org.id, count: messageIds.length }, "Retention purge completed");
        } catch (err) {
          fastify.log.error({ err, orgId: org.id }, "Retention purge failed for org");
        }
      }
    },
    { connection: queueConnection, concurrency: 1 }
  );

  fastify.addHook("onClose", async () => {
    await worker.close();
  });

  return worker;
}
