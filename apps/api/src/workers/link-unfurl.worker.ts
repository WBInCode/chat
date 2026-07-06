import { Worker, type Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { fileTypeFromBuffer } from "file-type";
import { s3, buildEmbedKey } from "../lib/s3.js";
import { env } from "../config/env.js";
import { unfurlUrl, fetchEmbedImage } from "../lib/unfurl.js";
import { queueConnection, LINK_UNFURL_QUEUE, type LinkUnfurlJobData } from "../lib/queue.js";
import { WS_SERVER_EVENTS } from "@chatv2/shared";

const ALLOWED_EMBED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function registerLinkUnfurlWorker(fastify: FastifyInstance) {
  const worker = new Worker<LinkUnfurlJobData>(
    LINK_UNFURL_QUEUE,
    async (job: Job<LinkUnfurlJobData>) => {
      const { messageId, channelId, url } = job.data;

      // Message may have been deleted before the job ran.
      const message = await fastify.prisma.message.findUnique({ where: { id: messageId } });
      if (!message || message.deletedAt) return;

      const result = await unfurlUrl(url).catch((err) => {
        fastify.log.debug({ err, url }, "Unfurl failed");
        return null;
      });
      if (!result || (!result.title && !result.description)) return;

      let imageKey: string | null = null;
      if (result.imageUrl) {
        try {
          const imgBuf = await fetchEmbedImage(result.imageUrl);
          if (imgBuf) {
            const detected = await fileTypeFromBuffer(imgBuf);
            if (detected && ALLOWED_EMBED_IMAGE_TYPES.has(detected.mime)) {
              imageKey = buildEmbedKey(randomUUID());
              await s3.send(
                new PutObjectCommand({
                  Bucket: env.S3_BUCKET,
                  Key: imageKey,
                  Body: imgBuf,
                  ContentType: detected.mime
                })
              );
            }
          }
        } catch (err) {
          fastify.log.debug({ err, url: result.imageUrl }, "Embed image fetch failed");
        }
      }

      const embed = await fastify.prisma.linkEmbed.create({
        data: {
          messageId,
          url,
          title: result.title?.slice(0, 300) ?? null,
          description: result.description?.slice(0, 500) ?? null,
          siteName: result.siteName?.slice(0, 100) ?? null,
          imageKey
        }
      });

      fastify.io.to(`channel:${channelId}`).emit(WS_SERVER_EVENTS.MessageEmbeds, {
        messageId,
        embeds: [
          {
            id: embed.id,
            url: embed.url,
            title: embed.title,
            description: embed.description,
            siteName: embed.siteName,
            hasImage: !!embed.imageKey
          }
        ]
      });
    },
    { connection: queueConnection, concurrency: 3 }
  );

  worker.on("failed", (job, err) => {
    fastify.log.debug({ err, jobId: job?.id }, "Link unfurl job failed");
  });

  fastify.addHook("onClose", async () => {
    await worker.close();
  });

  return worker;
}
