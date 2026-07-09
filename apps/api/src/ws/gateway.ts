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
  type ReactionGroupDto,
  type PollDto
} from "@chatv2/shared";
import { env } from "../config/env.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { createMessageService } from "../modules/messages/service.js";
import { HttpError, assertChannelMember, assertOrgPermission } from "../lib/authz.js";
import { assertModuleEnabled } from "../lib/modules.js";
import { setWsConnectionCount } from "../lib/metrics.js";

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
    wsBroadcastPollUpdate?: (payload: { messageId: string; channelId: string; poll: PollDto }) => void;
  }
}

const PRESENCE_TTL_SECONDS = 60;
const VOICE_TTL_SECONDS = 60;
const MAX_VOICE_PARTICIPANTS = 4;

function voiceUsersKey(channelId: string) {
  return `voice:room:${channelId}:users`;
}
function voiceMutedKey(channelId: string) {
  return `voice:room:${channelId}:muted`;
}

export default fp(async function wsGateway(fastify: FastifyInstance) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
    fastify.server,
    {
      path: "/ws",
      cors: { origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()), credentials: true },
      // Keep payloads small; message length is validated separately too.
      maxHttpBufferSize: 64 * 1024
    }
  );

  // Redis adapter → horizontal scaling (pub/sub between API instances).
  const redisTls = env.REDIS_URL.startsWith("rediss:") ? { tls: {} } : {};
  const pubClient = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, ...redisTls });
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

  async function broadcastVoiceParticipants(channelId: string) {
    const users = await fastify.redis.smembers(voiceUsersKey(channelId));
    const participants: { userId: string; muted: boolean }[] = [];
    if (users.length > 0) {
      const mutedVals = await fastify.redis.hmget(voiceMutedKey(channelId), ...users);
      for (let i = 0; i < users.length; i++) {
        participants.push({ userId: users[i]!, muted: mutedVals[i] === "1" });
      }
    }
    io.to(`voice:${channelId}`).emit(WS_SERVER_EVENTS.VoiceParticipants, { channelId, participants });
  }

  async function leaveVoiceRoom(channelId: string, userId: string, socket: { leave: (room: string) => Promise<void> | void }) {
    const wasMember = await fastify.redis.sismember(voiceUsersKey(channelId), userId);
    if (!wasMember) return;
    await fastify.redis.srem(voiceUsersKey(channelId), userId);
    await fastify.redis.hdel(voiceMutedKey(channelId), userId);
    await socket.leave(`voice:${channelId}`);
    io.to(`voice:${channelId}`).emit(WS_SERVER_EVENTS.VoicePeerLeft, { channelId, userId });
    await broadcastVoiceParticipants(channelId);
  }

  io.on("connection", async (socket) => {
    const { userId } = socket.data;
    setWsConnectionCount(io.engine.clientsCount);

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
        const readAt = await messages.markRead(userId, input.channelId, input.messageId);
        // Broadcast to others in the channel so they can render read receipts.
        socket.to(`channel:${input.channelId}`).emit(WS_SERVER_EVENTS.ReadUpdate, {
          channelId: input.channelId,
          userId,
          readAt: readAt.toISOString()
        });
      } catch {
        // read-marking failures are non-critical; ignore
      }
    });

    socket.on(WS_CLIENT_EVENTS.PresenceSet, async (payload) => {
      if (payload?.status !== "online" && payload?.status !== "away" && payload?.status !== "dnd") return;
      if (!(await allowEvent(userId, "presence", 20))) return;
      await setPresence(userId, payload.status);
    });

    socket.on(WS_CLIENT_EVENTS.VoiceJoin, async (payload) => {
      try {
        const channelId = payload?.channelId;
        if (!channelId) return;
        const member = await assertChannelMember(fastify, userId, channelId);
        await assertOrgPermission(fastify, userId, member.channel.orgId, "voice.use");
        await assertModuleEnabled(fastify, member.channel.orgId, "voice");

        const existing = await fastify.redis.smembers(voiceUsersKey(channelId));
        if (!existing.includes(userId) && existing.length >= MAX_VOICE_PARTICIPANTS) {
          return socket.emit(WS_SERVER_EVENTS.Error, {
            code: "VOICE_ROOM_FULL",
            message: "Rozmowa głosowa jest ograniczona do 4 osób (darmowy P2P mesh)."
          });
        }

        await socket.join(`voice:${channelId}`);
        await fastify.redis.sadd(voiceUsersKey(channelId), userId);
        await fastify.redis.hset(voiceMutedKey(channelId), userId, "0");
        await fastify.redis.expire(voiceUsersKey(channelId), VOICE_TTL_SECONDS);
        await fastify.redis.expire(voiceMutedKey(channelId), VOICE_TTL_SECONDS);
        await broadcastVoiceParticipants(channelId);
      } catch (err) {
        socket.emit(WS_SERVER_EVENTS.Error, {
          code: err instanceof HttpError ? err.code : "VOICE_JOIN_FAILED",
          message: "Nie udało się dołączyć do rozmowy głosowej"
        });
      }
    });

    socket.on(WS_CLIENT_EVENTS.VoiceLeave, async (payload) => {
      const channelId = payload?.channelId;
      if (!channelId) return;
      await leaveVoiceRoom(channelId, userId, socket);
    });

    socket.on(WS_CLIENT_EVENTS.VoiceOffer, (payload) => {
      if (!payload?.channelId || !payload?.toUserId) return;
      io.to(`user:${payload.toUserId}`).emit(WS_SERVER_EVENTS.VoiceOffer, {
        channelId: payload.channelId,
        fromUserId: userId,
        sdp: payload.sdp
      });
    });

    socket.on(WS_CLIENT_EVENTS.VoiceAnswer, (payload) => {
      if (!payload?.channelId || !payload?.toUserId) return;
      io.to(`user:${payload.toUserId}`).emit(WS_SERVER_EVENTS.VoiceAnswer, {
        channelId: payload.channelId,
        fromUserId: userId,
        sdp: payload.sdp
      });
    });

    socket.on(WS_CLIENT_EVENTS.VoiceIce, (payload) => {
      if (!payload?.channelId || !payload?.toUserId) return;
      io.to(`user:${payload.toUserId}`).emit(WS_SERVER_EVENTS.VoiceIce, {
        channelId: payload.channelId,
        fromUserId: userId,
        candidate: payload.candidate
      });
    });

    socket.on(WS_CLIENT_EVENTS.VoiceMute, async (payload) => {
      const channelId = payload?.channelId;
      if (!channelId) return;
      const isMember = await fastify.redis.sismember(voiceUsersKey(channelId), userId);
      if (!isMember) return;
      await fastify.redis.hset(voiceMutedKey(channelId), userId, payload.muted ? "1" : "0");
      io.to(`voice:${channelId}`).emit(WS_SERVER_EVENTS.VoiceMuteUpdate, {
        channelId,
        userId,
        muted: payload.muted
      });
    });

    socket.on("disconnect", async () => {
      clearInterval(heartbeat);
      setWsConnectionCount(io.engine.clientsCount);
      // Only mark offline when the user has no other open sockets.
      const remaining = await io.in(`user:${userId}`).fetchSockets();
      if (remaining.length === 0) {
        await setPresence(userId, "offline");
      }
      // Clean up any voice rooms this socket was part of.
      for (const room of socket.rooms) {
        if (room.startsWith("voice:")) {
          await leaveVoiceRoom(room.slice("voice:".length), userId, socket);
        }
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
  fastify.decorate(
    "wsBroadcastPollUpdate",
    (payload: { messageId: string; channelId: string; poll: PollDto }) => {
      io.to(`channel:${payload.channelId}`).emit(WS_SERVER_EVENTS.PollUpdate, payload);
    }
  );

  fastify.addHook("onClose", async () => {
    await io.close();
    // quit() flushes pending commands gracefully; fall back to disconnect.
    await Promise.allSettled([pubClient.quit(), subClient.quit()]);
  });
});
