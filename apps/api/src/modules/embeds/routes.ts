import type { FastifyInstance } from "fastify";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../../lib/s3.js";
import { env } from "../../config/env.js";
import { assertChannelMember, notFound, HttpError } from "../../lib/authz.js";
import { sendError } from "../../lib/validation.js";

export default async function embedRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return sendError(reply, error.status, error.code, error.message);
    }
    throw error;
  });

  /** Presigned URL to a fetched OG image, authorized via the embed's message/channel. */
  fastify.get("/embeds/:embedId/image", async (request) => {
    const { embedId } = request.params as { embedId: string };
    const embed = await fastify.prisma.linkEmbed.findUnique({
      where: { id: embedId },
      include: { message: true }
    });
    if (!embed || !embed.imageKey) notFound("Miniatura nie istnieje");
    await assertChannelMember(fastify, request.user!.id, embed.message.channelId);

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: embed.imageKey!, ResponseContentDisposition: "inline" }),
      { expiresIn: 600 }
    );
    return { url };
  });
}
