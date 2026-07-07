import type { FastifyInstance } from "fastify";
import {
  listMessagesQuerySchema,
  sendMessageSchema,
  editMessageSchema,
  toggleReactionSchema
} from "@chatv2/shared";
import { parseOrThrow } from "../../lib/validation.js";
import { createMessageService } from "./service.js";

export default async function messageRoutes(fastify: FastifyInstance) {
  const service = createMessageService(fastify);

  fastify.addHook("preHandler", fastify.authenticate);

  /** Paginated history, newest first, cursor-based. */
  fastify.get("/channels/:channelId/messages", async (request) => {
    const { channelId } = request.params as { channelId: string };
    const query = parseOrThrow(listMessagesQuerySchema, request.query);
    return service.listMessages(request.user!.id, channelId, {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {})
    });
  });

  /** HTTP fallback for sending (primary path is WebSocket). */
  fastify.post("/channels/:channelId/messages", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const input = parseOrThrow(sendMessageSchema, { ...(request.body as object), channelId });
    const message = await service.sendMessage(
      request.user!.id,
      channelId,
      input.content,
      input.fileIds,
      input.parentId
    );
    fastify.wsBroadcastNewMessage?.(message);
    return reply.status(201).send(message);
  });

  /** Full thread: parent + replies (oldest first). */
  fastify.get("/messages/:messageId/thread", async (request) => {
    const { messageId } = request.params as { messageId: string };
    return service.listThread(request.user!.id, messageId);
  });

  /** Permalink support: a window of messages centered on one specific message. */
  fastify.get("/channels/:channelId/messages/around/:messageId", async (request) => {
    const { channelId, messageId } = request.params as { channelId: string; messageId: string };
    return service.listAround(request.user!.id, channelId, messageId);
  });

  /** HTTP fallback for reactions (primary path is WebSocket). */
  fastify.post("/messages/:messageId/reactions", async (request) => {
    const { messageId } = request.params as { messageId: string };
    const input = parseOrThrow(toggleReactionSchema, {
      ...(request.body as object),
      messageId
    });
    const result = await service.toggleReaction(request.user!.id, messageId, input.emoji);
    fastify.wsBroadcastReactionUpdate?.(result);
    return result;
  });

  fastify.patch("/messages/:messageId", async (request) => {
    const { messageId } = request.params as { messageId: string };
    const input = parseOrThrow(editMessageSchema, request.body);
    const message = await service.editMessage(request.user!.id, messageId, input.content);
    fastify.wsBroadcastUpdatedMessage?.(message);
    return message;
  });

  fastify.delete("/messages/:messageId", async (request, reply) => {
    const { messageId } = request.params as { messageId: string };
    const result = await service.deleteMessage(request.user!.id, messageId);
    fastify.wsBroadcastDeletedMessage?.(result);
    return reply.status(204).send();
  });

  /** Pin/unpin a message (channel-ADMIN only) — reuses the message:updated WS broadcast. */
  fastify.post("/messages/:messageId/pin", async (request) => {
    const { messageId } = request.params as { messageId: string };
    const message = await service.setPinned(request.user!.id, messageId, true);
    fastify.wsBroadcastUpdatedMessage?.(message);
    return message;
  });

  fastify.delete("/messages/:messageId/pin", async (request) => {
    const { messageId } = request.params as { messageId: string };
    const message = await service.setPinned(request.user!.id, messageId, false);
    fastify.wsBroadcastUpdatedMessage?.(message);
    return message;
  });

  fastify.get("/channels/:channelId/pinned", async (request) => {
    const { channelId } = request.params as { channelId: string };
    return service.listPinned(request.user!.id, channelId);
  });

  /** Personal bookmark — independent of channel-level pinning. */
  fastify.post("/messages/:messageId/save", async (request) => {
    const { messageId } = request.params as { messageId: string };
    return service.toggleSaved(request.user!.id, messageId);
  });

  fastify.get("/me/saved-messages", async (request) => {
    return service.listSaved(request.user!.id);
  });
}
