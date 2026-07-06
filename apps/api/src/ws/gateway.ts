import fp from "fastify-plugin";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import type { FastifyInstance } from "fastify";
import {
  WS_CLIENT_EVENTS,
  WS_SERVER_EVENTS,
  sendMessageSchema,
  editMessageSchema,
  markReadSchema,
  toggleReactionSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type MessageDto,
  type ReactionGroupDto
} from "@chatv2/shared";
import { env } from "../config/env.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { createMessageService } from "../modules/messages/service.js";
import { HttpError } from "../lib/authz.js";

interface SocketData {
  userId: string;
  sessionId: string;
}

declare module "fastify" {
  interface FastifyInstance {
    io: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
    wsBroadcastNewMessage?: (message: MessageDto) => void;
    wsBroadcastUpdatedMessage?: (message: MessageDto) => void;
    wsBroadcastDeletedMessage?: (payload: { messageId: string; channelId: string }) => void;
    wsBroadcastReactionUpdate?: (payload: {
      messageId: string;
      channelId: string;
      reactions: ReactionGroupDto[];
    }) => void;
  }
}

const PRESENCE_TTL_SECONDS = 60;

export default fp(async function wsGateway(fastify: FastifyInstance) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
    fastify.server,
    {
      path: "/ws",
      cors: { origin: env.CORS_ORIGIN.split(","), credentials: true },
      // Keep payloads small; message length is validated separately too.
      maxHttpBufferSize: 64 * 1024
    }
  );

  // Redis adapter → horizontal scaling (pub/sub between API instances).
  const pubClient = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  const subClient = pubClient.duplicate();
  // Swallow late errors during shutdown (ioredis rejects in-flight commands).
  pubClient.on("error", (err: Error) => fastify.log.debug({ err }, "ws pub redis error"));
  subClient.on("error", (err: Error) => fastify.log.debug({ err }, "ws sub redis error"));
  io.adapter(createAdapter(pubClient, subClient));

  const messages = createMessageService(fastify);

  /** Auth at handshake: token in auth payload (never query string). */
  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string }).token;
      if (!token) return next(new Error("UNAUTHORIZED"));
      const payload = await verifyAccessToken(token);
      const revoked = await fastify.redis.get(`revoked-session:${payload.sid}`);
      if (revoked) return next(new Error("UNAUTHORIZED"));
      socket.data.userId = payload.sub;
      socket.data.sessionId = payload.sid;
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });

  /** Simple sliding-window rate limit per user per event type (Redis). */
  async function allowEvent(userId: string, event: string, maxPerTenSeconds: number) {
    const key = `ws-rate:${userId}:${event}`;
    const count = await fastify.redis.incr(key);
    if (count === 1) await fastify.redis.expire(key, 10);
    return count <= maxPerTenSeconds;
  }

  async function setPresence(userId: string, status: "online" | "away" | "dnd" | "offline") {
    if (status === "offline") {
      await fastify.redis.del(`presence:${userId}`);
    } else {
      await fastify.redis.set(`presence:${userId}`, status, "EX", PRESENCE_TTL_SECONDS);
    }
    io.emit(WS_SERVER_EVENTS.PresenceUpdate, {
      userId,
      status,
      lastSeenAt: new Date().toISOString()
    });
  }

  io.on("connection", async (socket) => {
    const { userId } = socket.data;

    // Join rooms for every channel the user belongs to (server-decided).
    const memberships = await fastify.prisma.channelMember.findMany({
      where: { userId },
      select: { channelId: true }
    });
    for (const m of memberships) {
      await socket.join(`channel:${m.channelId}`);
    }
    await socket.join(`user:${userId}`);
    await setPresence(userId, "online");

    // Heartbeat refresh of presence TTL.
    const heartbeat = setInterval(() => {
      void fastify.redis.expire(`presence:${userId}`, PRESENCE_TTL_SECONDS);
    }, 25_000);

    socket.on(WS_CLIENT_EVENTS.MessageSend, async (payload) => {
      try {
        if (!(await allowEvent(userId, "msg", 100))) {
          return socket.emit(WS_SERVER_EVENTS.Error, {
            code: "RATE_LIMITED",
            message: "Za dużo wiadomości, zwolnij"
          });
        }
        const input = sendMessageSchema.parse(payload);
        const message = await messages.sendMessage(
          userId,
          input.channelId,
          input.content,
          input.fileIds,
          input.parentId
        );
        // Ensure sender's socket is in the room (e.g. channel joined after connect).
        await socket.join(`channel:${input.channelId}`);
        io.to(`channel:${input.channelId}`).emit(WS_SERVER_EVENTS.MessageNew, {
          ...message,
          ...(input.tempId ? { tempId: input.tempId } : {})
        });
      } catch (err) {
        socket.emit(WS_SERVER_EVENTS.Error, {
          code: err instanceof HttpError ? err.code : "SEND_FAILED",
          message: "Nie udało się wysłać wiadomości"
        });
      }
    });

    socket.on(WS_CLIENT_EVENTS.MessageEdit, async (payload) => {
      try {
        const input = editMessageSchema.parse({ content: payload.content });
        const message = await messages.editMessage(userId, payload.messageId, input.content);
        io.to(`channel:${message.channelId}`).emit(WS_SERVER_EVENTS.MessageUpdated, message);
      } catch (err) {
        socket.emit(WS_SERVER_EVENTS.Error, {
          code: err instanceof HttpError ? err.code : "EDIT_FAILED",
          message: "Nie udało się edytować wiadomości"
        });
      }
    });

    socket.on(WS_CLIENT_EVENTS.MessageDelete, async (payload) => {
      try {
        const result = await messages.deleteMessage(userId, payload.messageId);
        io.to(`channel:${result.channelId}`).emit(WS_SERVER_EVENTS.MessageDeleted, result);
      } catch (err) {
        socket.emit(WS_SERVER_EVENTS.Error, {
          code: err instanceof HttpError ? err.code : "DELETE_FAILED",
          message: "Nie udało się usunąć wiadomości"
        });
      }
    });

    socket.on(WS_CLIENT_EVENTS.ReactionToggle, async (payload) => {
      try {
        if (!(await allowEvent(userId, "reaction", 30))) return;
        const input = toggleReactionSchema.parse(payload);
        const result = await messages.toggleReaction(userId, input.messageId, input.emoji);
        io.to(`channel:${result.channelId}`).emit(WS_SERVER_EVENTS.ReactionUpdate, result);
      } catch (err) {
        socket.emit(WS_SERVER_EVENTS.Error, {
          code: err instanceof HttpError ? err.code : "REACTION_FAILED",
          message: "Nie udało się dodać reakcji"
        });
      }
    });

    socket.on(WS_CLIENT_EVENTS.TypingStart, async (payload) => {
      if (!(await allowEvent(userId, "typing", 20))) return;
      socket.to(`channel:${payload.channelId}`).emit(WS_SERVER_EVENTS.TypingUpdate, {
        channelId: payload.channelId,
        userId,
        isTyping: true
      });
    });

    socket.on(WS_CLIENT_EVENTS.TypingStop, (payload) => {
      socket.to(`channel:${payload.channelId}`).emit(WS_SERVER_EVENTS.TypingUpdate, {
        channelId: payload.channelId,
        userId,
        isTyping: false
      });
    });

    socket.on(WS_CLIENT_EVENTS.ReadMark, async (payload) => {
      try {
        const input = markReadSchema.parse(payload);
        await messages.markRead(userId, input.channelId, input.messageId);
      } catch {
        // read-marking failures are non-critical; ignore
      }
    });

    socket.on(WS_CLIENT_EVENTS.PresenceSet, async (payload) => {
      if (payload?.status !== "online" && payload?.status !== "away" && payload?.status !== "dnd") return;
      if (!(await allowEvent(userId, "presence", 20))) return;
      await setPresence(userId, payload.status);
    });

    socket.on("disconnect", async () => {
      clearInterval(heartbeat);
      // Only mark offline when the user has no other open sockets.
      const remaining = await io.in(`user:${userId}`).fetchSockets();
      if (remaining.length === 0) {
        await setPresence(userId, "offline");
      }
    });
  });

  fastify.decorate("io", io);
  fastify.decorate("wsBroadcastNewMessage", (message: MessageDto) => {
    io.to(`channel:${message.channelId}`).emit(WS_SERVER_EVENTS.MessageNew, message);
  });
  fastify.decorate("wsBroadcastUpdatedMessage", (message: MessageDto) => {
    io.to(`channel:${message.channelId}`).emit(WS_SERVER_EVENTS.MessageUpdated, message);
  });
  fastify.decorate("wsBroadcastDeletedMessage", (payload: { messageId: string; channelId: string }) => {
    io.to(`channel:${payload.channelId}`).emit(WS_SERVER_EVENTS.MessageDeleted, payload);
  });
  fastify.decorate(
    "wsBroadcastReactionUpdate",
    (payload: { messageId: string; channelId: string; reactions: ReactionGroupDto[] }) => {
      io.to(`channel:${payload.channelId}`).emit(WS_SERVER_EVENTS.ReactionUpdate, payload);
    }
  );

  fastify.addHook("onClose", async () => {
    await io.close();
    // quit() flushes pending commands gracefully; fall back to disconnect.
    await Promise.allSettled([pubClient.quit(), subClient.quit()]);
  });
});
