import { Worker, type Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "../lib/s3.js";
import { env } from "../config/env.js";
import { scanBuffer } from "../lib/clamav.js";
import { queueConnection, FILE_SCAN_QUEUE, enqueueFilePreview, type FileScanJobData } from "../lib/queue.js";
import { WS_SERVER_EVENTS, OFFICE_MIME_TYPES } from "@chatv2/shared";
import { logAudit } from "../lib/audit.js";

/**
 * Runs in-process (same Node process as the API) so it can reuse the
 * Fastify instance's Prisma client and Socket.IO server to push live
 * status updates. For higher throughput this could be split into a
 * separate worker process later — the queue/job contract stays the same.
 */
export function registerFileScanWorker(fastify: FastifyInstance) {
  const worker = new Worker<FileScanJobData>(
    FILE_SCAN_QUEUE,
    async (job: Job<FileScanJobData>) => {
      const { fileId } = job.data;
      const file = await fastify.prisma.file.findUnique({ where: { id: fileId } });
      if (!file) return; // deleted before scan ran

      const obj = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: file.key }));
      const buf = Buffer.from(await obj.Body!.transformToByteArray());

      const result = await scanBuffer(buf);

      if (result.infected) {
        fastify.log.warn({ fileId, signature: result.signature }, "Infected file detected, removing");
        await Promise.allSettled([
          s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: file.key })),
          file.thumbKey
            ? s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: file.thumbKey }))
            : Promise.resolve()
        ]);
        await fastify.prisma.file.update({ where: { id: fileId }, data: { status: "INFECTED" } });
        await logAudit(fastify, {
          orgId: file.orgId,
          actorId: file.uploaderId,
          action: "file.infected",
          meta: { fileId, name: file.name, signature: result.signature },
          ip: null
        });
      } else {
        await fastify.prisma.file.update({ where: { id: fileId }, data: { status: "CLEAN" } });
        if ((OFFICE_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
          await fastify.prisma.file.update({
            where: { id: fileId },
            data: { previewStatus: "PENDING" }
          });
          await enqueueFilePreview(fileId);
        }
      }

      fastify.io.to(`channel:${file.channelId}`).emit(WS_SERVER_EVENTS.FileStatus, {
        fileId,
        channelId: file.channelId,
        status: result.infected ? "INFECTED" : "CLEAN"
      });
    },
    { connection: queueConnection, concurrency: 4 }
  );

  worker.on("failed", (job, err) => {
    fastify.log.error({ err, jobId: job?.id }, "File scan job failed");
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      // Exhausted retries (e.g. ClamAV unreachable) — mark FAILED so the
      // UI stops showing "scanning..." forever, and require re-upload.
      void fastify.prisma.file
        .update({ where: { id: job.data.fileId }, data: { status: "FAILED" } })
        .catch(() => {});
    }
  });

  fastify.addHook("onClose", async () => {
    await worker.close();
  });

  return worker;
}
