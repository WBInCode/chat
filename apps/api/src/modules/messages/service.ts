import type { FastifyInstance } from "fastify";
import type { MessageDto, FileDto, LinkEmbedDto, ReactionGroupDto } from "@chatv2/shared";
import { assertChannelMember, HttpError, forbidden, notFound } from "../../lib/authz.js";
import { createFileService } from "../files/service.js";
import { enqueueLinkUnfurl } from "../../lib/queue.js";
import { sendPushToUser } from "../../lib/push.js";
import { mentionsAiBot, triggerAiBotReply } from "../../lib/ai-bot.js";

// Only the first few links per message are unfurled — avoids a single
// message with a wall of URLs fanning out into dozens of outbound
// requests and embed cards.
const MAX_LINKS_PER_MESSAGE = 3;
const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

function extractUrls(content: string): string[] {
  const matches = content.match(URL_REGEX) ?? [];
  return [...new Set(matches)].slice(0, MAX_LINKS_PER_MESSAGE);
}

function toDto(
  m: {
    id: string;
    channelId: string;
    authorId: string;
    content: string;
    contentType: string;
    parentId: string | null;
    editedAt: Date | null;
    deletedAt: Date | null;
    createdAt: Date;
    pinnedAt?: Date | null;
  },
  files?: FileDto[],
  embeds?: LinkEmbedDto[],
  reactions?: ReactionGroupDto[],
  replyCount?: number
): MessageDto {
  return {
    id: m.id,
    channelId: m.channelId,
    authorId: m.authorId,
    // Soft-deleted messages keep their slot but content is blanked out.
    content: m.deletedAt ? "" : m.content,
    contentType: m.contentType as MessageDto["contentType"],
    parentId: m.parentId,
    editedAt: m.editedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    pinnedAt: m.pinnedAt?.toISOString() ?? null,
    ...(files && files.length > 0 ? { files } : {}),
    ...(embeds && embeds.length > 0 ? { embeds } : {}),
    ...(reactions && reactions.length > 0 ? { reactions } : {}),
    ...(replyCount && replyCount > 0 ? { replyCount } : {})
  };
}

export function createMessageService(fastify: FastifyInstance) {
  const files = createFileService(fastify);

  /** Groups raw reaction rows into per-emoji aggregates for the DTO. */
  async function reactionsForMessages(messageIds: string[]): Promise<Map<string, ReactionGroupDto[]>> {
    if (messageIds.length === 0) return new Map();
    const rows = await fastify.prisma.reaction.findMany({
      where: { messageId: { in: messageIds } },
      orderBy: { createdAt: "asc" }
    });
    const map = new Map<string, Map<string, ReactionGroupDto>>();
    for (const r of rows) {
      const byEmoji = map.get(r.messageId) ?? new Map<string, ReactionGroupDto>();
      const group = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, userIds: [] };
      group.count += 1;
      group.userIds.push(r.userId);
      byEmoji.set(r.emoji, group);
      map.set(r.messageId, byEmoji);
    }
    const result = new Map<string, ReactionGroupDto[]>();
    for (const [msgId, byEmoji] of map) result.set(msgId, [...byEmoji.values()]);
    return result;
  }

  async function replyCounts(messageIds: string[]): Promise<Map<string, number>> {
    if (messageIds.length === 0) return new Map();
    const rows = await fastify.prisma.message.groupBy({
      by: ["parentId"],
      where: { parentId: { in: messageIds }, deletedAt: null },
      _count: { _all: true }
    });
    return new Map(rows.map((r) => [r.parentId as string, r._count._all]));
  }

  async function hydrate(page: { id: string }[]) {
    const ids = page.map((m) => m.id);
    const [filesBy, reactionsBy, repliesBy, embedRows] = await Promise.all([
      files.listForMessages(ids),
      reactionsForMessages(ids),
      replyCounts(ids),
      fastify.prisma.linkEmbed.findMany({
        where: { messageId: { in: ids } },
        orderBy: { createdAt: "asc" }
      })
    ]);
    const embedsBy = new Map<string, LinkEmbedDto[]>();
    for (const e of embedRows) {
      const list = embedsBy.get(e.messageId) ?? [];
      list.push({
        id: e.id,
        url: e.url,
        title: e.title,
        description: e.description,
        siteName: e.siteName,
        hasImage: !!e.imageKey
      });
      embedsBy.set(e.messageId, list);
    }
    return { filesBy, reactionsBy, repliesBy, embedsBy };
  }

  async function listMessages(
    userId: string,
    channelId: string,
    opts: { cursor?: string; limit: number }
  ) {
    await assertChannelMember(fastify, userId, channelId);

    const messages = await fastify.prisma.message.findMany({
      // Top-level only — thread replies live in the thread panel.
      where: { channelId, parentId: null },
      orderBy: { createdAt: "desc" },
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {})
    });

    const hasMore = messages.length > opts.limit;
    const page = hasMore ? messages.slice(0, opts.limit) : messages;
    const { filesBy, reactionsBy, repliesBy, embedsBy } = await hydrate(page);

    return {
      messages: page.map((m) =>
        toDto(m, filesBy.get(m.id), embedsBy.get(m.id), reactionsBy.get(m.id), repliesBy.get(m.id))
      ),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null
    };
  }

  /**
   * Permalink support: fetch a window of messages centered on a specific
   * one (e.g. from a "copy link" action or search result), so the client
   * can jump straight to it without paging through the whole history.
   */
  async function listAround(userId: string, channelId: string, messageId: string, radius = 25) {
    await assertChannelMember(fastify, userId, channelId);
    const target = await fastify.prisma.message.findUnique({ where: { id: messageId } });
    if (!target || target.channelId !== channelId) notFound("Wiadomość nie istnieje");

    const [before, after] = await Promise.all([
      fastify.prisma.message.findMany({
        where: { channelId, parentId: null, createdAt: { lt: target.createdAt } },
        orderBy: { createdAt: "desc" },
        take: radius
      }),
      fastify.prisma.message.findMany({
        where: { channelId, parentId: null, createdAt: { gte: target.createdAt } },
        orderBy: { createdAt: "asc" },
        take: radius
      })
    ]);

    const page = [...before.reverse(), ...after].filter(
      (m, i, arr) => arr.findIndex((x) => x.id === m.id) === i
    );
    const { filesBy, reactionsBy, repliesBy, embedsBy } = await hydrate(page);

    return {
      messages: page.map((m) =>
        toDto(m, filesBy.get(m.id), embedsBy.get(m.id), reactionsBy.get(m.id), repliesBy.get(m.id))
      ),
      targetId: target.id
    };
  }

  /** All replies of a thread, oldest first, incl. the parent message. */
  async function listThread(userId: string, parentId: string) {
    const parent = await fastify.prisma.message.findUnique({ where: { id: parentId } });
    if (!parent || parent.deletedAt) notFound("Wiadomość nie istnieje");
    await assertChannelMember(fastify, userId, parent.channelId);

    const replies = await fastify.prisma.message.findMany({
      where: { parentId, deletedAt: null },
      orderBy: { createdAt: "asc" }
    });

    const all = [parent, ...replies];
    const { filesBy, reactionsBy, repliesBy, embedsBy } = await hydrate(all);

    return {
      parent: toDto(parent, filesBy.get(parent.id), embedsBy.get(parent.id), reactionsBy.get(parent.id), repliesBy.get(parent.id)),
      replies: replies.map((m) =>
        toDto(m, filesBy.get(m.id), embedsBy.get(m.id), reactionsBy.get(m.id))
      )
    };
  }

  async function sendMessage(
    userId: string,
    channelId: string,
    content: string,
    fileIds: string[] = [],
    parentId?: string
  ) {
    await assertChannelMember(fastify, userId, channelId);

    if (parentId) {
      const parent = await fastify.prisma.message.findUnique({ where: { id: parentId } });
      // Parent must exist in the SAME channel; also disallow nesting
      // (replying to a reply attaches to the root — single-level threads).
      if (!parent || parent.deletedAt || parent.channelId !== channelId) {
        notFound("Wątek nie istnieje");
      }
      if (parent.parentId) parentId = parent.parentId;
    }

    const contentType = fileIds.length > 0 ? "file" : "text";
    const message = await fastify.prisma.message.create({
      data: { channelId, authorId: userId, content, contentType, parentId: parentId ?? null }
    });

    if (fileIds.length > 0) {
      await files.attachToMessage(userId, fileIds, message.id, channelId);
    }

    for (const url of extractUrls(content)) {
      await enqueueLinkUnfurl({ messageId: message.id, channelId, url });
    }

    const filesByMessage = await files.listForMessages([message.id]);
    const dto = toDto(message, filesByMessage.get(message.id));

    // Fire-and-forget: notification delivery must never delay/replace the
    // message-send response or WS broadcast.
    void notifyRecipients(userId, channelId, message.id, content).catch((err) =>
      fastify.log.warn({ err }, "notifyRecipients failed")
    );

    // Fire-and-forget: "@AI" mentions trigger the assistant bot (F5-D) —
    // never delays or fails the human's own send.
    if (mentionsAiBot(content)) {
      void triggerAiBotReply(fastify, channelId, message.id, parentId ?? null).catch((err) =>
        fastify.log.warn({ err }, "triggerAiBotReply failed")
      );
    }

    return dto;
  }

  /**
   * Web Push fan-out for a newly sent message. Respects: per-channel mute,
   * per-user notification mode (ALL/MENTIONS/NONE — DMs always count as a
   * "mention" since they're inherently 1:1 directed), and skips users
   * currently in Do Not Disturb presence.
   */
  async function notifyRecipients(authorId: string, channelId: string, messageId: string, content: string) {
    const channel = await fastify.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) return;

    const author = await fastify.prisma.user.findUnique({ where: { id: authorId } });
    const recipients = await fastify.prisma.channelMember.findMany({
      where: { channelId, userId: { not: authorId } },
      include: { user: true }
    });

    const preview = content.length > 120 ? `${content.slice(0, 120)}…` : content;

    await Promise.all(
      recipients.map(async (member) => {
        if (member.mutedAt) return;
        if (member.user.notifyMode === "NONE") return;

        const isMentioned = content.includes(`@${member.user.displayName}`);
        const isDm = channel.type === "DM";
        if (member.user.notifyMode === "MENTIONS" && !isMentioned && !isDm) return;

        const dndStatus = await fastify.redis.get(`presence:${member.userId}`);
        if (dndStatus === "dnd") return;

        await sendPushToUser(fastify, member.userId, {
          title: isDm ? `${author?.displayName ?? "Wiadomość"}` : `${author?.displayName ?? "Ktoś"} w #${channel.name ?? "kanale"}`,
          body: preview || "📎 Załącznik",
          channelId,
          messageId
        });
      })
    );
  }

  /** Idempotent toggle: same user+emoji again removes the reaction. */
  async function toggleReaction(userId: string, messageId: string, emoji: string) {
    const message = await fastify.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) notFound("Wiadomość nie istnieje");
    await assertChannelMember(fastify, userId, message.channelId);

    const existing = await fastify.prisma.reaction.findUnique({
      where: { messageId_userId_emoji: { messageId, userId, emoji } }
    });

    if (existing) {
      await fastify.prisma.reaction.delete({ where: { id: existing.id } });
    } else {
      await fastify.prisma.reaction.create({ data: { messageId, userId, emoji } });
    }

    const reactionsBy = await reactionsForMessages([messageId]);
    return {
      messageId,
      channelId: message.channelId,
      reactions: reactionsBy.get(messageId) ?? []
    };
  }

  async function editMessage(userId: string, messageId: string, content: string) {
    const message = await fastify.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) notFound("Wiadomość nie istnieje");
    await assertChannelMember(fastify, userId, message.channelId);
    if (message.authorId !== userId) {
      forbidden("Możesz edytować tylko własne wiadomości");
    }

    const updated = await fastify.prisma.message.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() }
    });

    return toDto(updated);
  }

  async function deleteMessage(userId: string, messageId: string) {
    const message = await fastify.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) notFound("Wiadomość nie istnieje");
    const membership = await assertChannelMember(fastify, userId, message.channelId);
    if (message.authorId !== userId && membership.role !== "ADMIN") {
      forbidden("Możesz usuwać tylko własne wiadomości");
    }

    await fastify.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() }
    });

    return { messageId, channelId: message.channelId };
  }

  async function markRead(userId: string, channelId: string, messageId: string) {
    await assertChannelMember(fastify, userId, channelId);
    const message = await fastify.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.channelId !== channelId) notFound("Wiadomość nie istnieje");

    await fastify.prisma.channelMember.update({
      where: { channelId_userId: { channelId, userId } },
      data: { lastReadAt: message.createdAt }
    });
  }

  /** Pin/unpin require channel-level ADMIN (moderator) role, same bar as deleting others' messages. */
  async function setPinned(userId: string, messageId: string, pinned: boolean) {
    const message = await fastify.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) notFound("Wiadomość nie istnieje");
    const membership = await assertChannelMember(fastify, userId, message.channelId);
    if (membership.role !== "ADMIN") {
      forbidden("Tylko administrator kanału może przypinać wiadomości");
    }

    const updated = await fastify.prisma.message.update({
      where: { id: messageId },
      data: pinned ? { pinnedAt: new Date(), pinnedBy: userId } : { pinnedAt: null, pinnedBy: null }
    });

    const filesByMessage = await files.listForMessages([messageId]);
    return toDto(updated, filesByMessage.get(messageId));
  }

  async function listPinned(userId: string, channelId: string) {
    await assertChannelMember(fastify, userId, channelId);
    const pinned = await fastify.prisma.message.findMany({
      where: { channelId, pinnedAt: { not: null }, deletedAt: null },
      orderBy: { pinnedAt: "desc" }
    });
    const { filesBy, reactionsBy, repliesBy, embedsBy } = await hydrate(pinned);
    return pinned.map((m) =>
      toDto(m, filesBy.get(m.id), embedsBy.get(m.id), reactionsBy.get(m.id), repliesBy.get(m.id))
    );
  }

  /** Personal bookmark, independent from pinning — any channel member can save any message they can see. */
  async function toggleSaved(userId: string, messageId: string) {
    const message = await fastify.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) notFound("Wiadomość nie istnieje");
    await assertChannelMember(fastify, userId, message.channelId);

    const existing = await fastify.prisma.savedMessage.findUnique({
      where: { userId_messageId: { userId, messageId } }
    });
    if (existing) {
      await fastify.prisma.savedMessage.delete({ where: { id: existing.id } });
      return { messageId, saved: false };
    }
    await fastify.prisma.savedMessage.create({ data: { userId, messageId } });
    return { messageId, saved: true };
  }

  async function listSaved(userId: string) {
    const saved = await fastify.prisma.savedMessage.findMany({
      where: { userId },
      include: { message: true },
      orderBy: { createdAt: "desc" }
    });
    const messages = saved.map((s) => s.message).filter((m) => !m.deletedAt);
    const { filesBy, reactionsBy, repliesBy, embedsBy } = await hydrate(messages);
    const byId = new Map(messages.map((m) => [m.id, m]));

    return saved
      .filter((s) => byId.has(s.messageId))
      .map((s) => {
        const m = byId.get(s.messageId)!;
        return {
          savedAt: s.createdAt.toISOString(),
          message: toDto(m, filesBy.get(m.id), embedsBy.get(m.id), reactionsBy.get(m.id), repliesBy.get(m.id))
        };
      });
  }

  return {
    listMessages,
    listAround,
    listThread,
    sendMessage,
    editMessage,
    deleteMessage,
    markRead,
    toggleReaction,
    setPinned,
    listPinned,
    toggleSaved,
    listSaved
  };
}

export type MessageService = ReturnType<typeof createMessageService>;
export { HttpError };
