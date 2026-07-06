import { Worker, type Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, buildFileKey } from "../lib/s3.js";
import { env } from "../config/env.js";
import { convertToPdf } from "../lib/gotenberg.js";
import { queueConnection, FILE_PREVIEW_QUEUE, type FilePreviewJobData } from "../lib/queue.js";
import { WS_SERVER_EVENTS } from "@chatv2/shared";

/**
 * Converts office documents (docx/xlsx/pptx) to PDF via Gotenberg so the
 * frontend only ever needs a single PDF viewer (pdf.js) for every document
 * type — no per-format rendering logic in the browser.
 */
export function registerFilePreviewWorker(fastify: FastifyInstance) {
  const worker = new Worker<FilePreviewJobData>(
    FILE_PREVIEW_QUEUE,
    async (job: Job<FilePreviewJobData>) => {
      const { fileId } = job.data;
      const file = await fastify.prisma.file.findUnique({ where: { id: fileId } });
      if (!file || file.status !== "CLEAN") return;

      const obj = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: file.key }));
      const buf = Buffer.from(await obj.Body!.transformToByteArray());

      const pdfBuf = await convertToPdf(buf, file.name);
      const previewKey = `${buildFileKey(file.orgId, file.channelId, file.id, file.name)}.preview.pdf`;

      await s3.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: previewKey,
          Body: pdfBuf,
          ContentType: "application/pdf"
        })
      );

      await fastify.prisma.file.update({
        where: { id: fileId },
        data: { previewKey, previewStatus: "READY" }
      });

      fastify.io.to(`channel:${file.channelId}`).emit(WS_SERVER_EVENTS.FilePreview, {
        fileId,
        channelId: file.channelId,
        previewStatus: "READY"
      });
    },
    { connection: queueConnection, concurrency: 2 }
  );

  worker.on("failed", (job, err) => {
    fastify.log.error({ err, jobId: job?.id }, "File preview job failed");
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void fastify.prisma.file
        .update({ where: { id: job.data.fileId }, data: { previewStatus: "FAILED" } })
        .then((file) =>
          fastify.io.to(`channel:${file.channelId}`).emit(WS_SERVER_EVENTS.FilePreview, {
            fileId: job.data.fileId,
            channelId: file.channelId,
            previewStatus: "FAILED"
          })
        )
        .catch(() => {});
    }
  });

  fastify.addHook("onClose", async () => {
    await worker.close();
  });

  return worker;
}
