import type { FastifyInstance } from "fastify";
import { presignFileSchema } from "@chatv2/shared";
import { parseOrThrow } from "../../lib/validation.js";
import { assertChannelMember } from "../../lib/authz.js";
import { assertModuleEnabled } from "../../lib/modules.js";
import { createFileService } from "./service.js";

export default async function fileRoutes(fastify: FastifyInstance) {
  const service = createFileService(fastify);

  fastify.addHook("preHandler", fastify.authenticate);

  fastify.post("/files/presign", async (request) => {
    const input = parseOrThrow(presignFileSchema, request.body);
    const userId = request.user!.id;

    const membership = await assertChannelMember(fastify, userId, input.channelId);
    await assertModuleEnabled(fastify, membership.channel.orgId, "files");
    return service.presign(userId, membership.channel.orgId, input);
  });

  fastify.post("/files/:fileId/complete", async (request) => {
    const { fileId } = request.params as { fileId: string };
    return service.complete(request.user!.id, fileId);
  });

  fastify.get("/files/:fileId/url", async (request) => {
    const { fileId } = request.params as { fileId: string };
    const { variant } = request.query as { variant?: string };
    const resolvedVariant =
      variant === "thumb" ? "thumb" : variant === "preview" ? "preview" : "original";
    return service.getDownloadUrl(request.user!.id, fileId, resolvedVariant);
  });
}
