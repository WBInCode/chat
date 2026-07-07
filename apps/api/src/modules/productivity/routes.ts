import type { FastifyInstance } from "fastify";
import {
  scheduleMessageSchema,
  createReminderSchema,
  createPollSchema,
  type ScheduledMessageDto,
  type ReminderDto,
  type PollDto
} from "@chatv2/shared";
import { parseOrThrow } from "../../lib/validation.js";
import { assertChannelMember, notFound, HttpError } from "../../lib/authz.js";
import { sendError } from "../../lib/validation.js";

function toScheduledDto(row: {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  sendAt: Date;
  sentAt: Date | null;
  createdAt: Date;
}): ScheduledMessageDto {
  return {
    id: row.id,
    channelId: row.channelId,
    authorId: row.authorId,
    content: row.content,
    sendAt: row.sendAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
}

function toReminderDto(row: {
  id: string;
  messageId: string;
  channelId: string;
  note: string | null;
  remindAt: Date;
  sentAt: Date | null;
  createdAt: Date;
}): ReminderDto {
  return {
    id: row.id,
    messageId: row.messageId,
    channelId: row.channelId,
    note: row.note,
    remindAt: row.remindAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
}

/**
 * F4-E "everyday productivity" endpoints: scheduled sends ("send later"),
 * per-message reminders (delivered as a push notification), and simple
 * polls attached to a message.
 */
export default async function productivityRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return sendError(reply, error.status, error.code, error.message);
    }
    throw error;
  });

  // ── scheduled messages ("send later") ────────────────────────────────
  fastify.post("/channels/:channelId/schedule", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(scheduleMessageSchema, request.body);
    await assertChannelMember(fastify, userId, channelId);

    if (new Date(input.sendAt).getTime() <= Date.now()) {
      return sendError(reply, 400, "SEND_AT_IN_PAST", "Czas wysyłki musi być w przyszłości");
    }

    const row = await fastify.prisma.scheduledMessage.create({
      data: { channelId, authorId: userId, content: input.content, sendAt: new Date(input.sendAt) }
    });
    return reply.status(201).send(toScheduledDto(row));
  });

  fastify.get("/channels/:channelId/scheduled", async (request) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;
    await assertChannelMember(fastify, userId, channelId);

    const rows = await fastify.prisma.scheduledMessage.findMany({
      where: { channelId, authorId: userId, sentAt: null },
      orderBy: { sendAt: "asc" }
    });
    return rows.map(toScheduledDto);
  });

  fastify.delete("/scheduled-messages/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;
    const row = await fastify.prisma.scheduledMessage.findUnique({ where: { id } });
    if (!row || row.authorId !== userId) notFound("Zaplanowana wiadomość nie istnieje");
    if (row.sentAt) return sendError(reply, 400, "ALREADY_SENT", "Wiadomość została już wysłana");

    await fastify.prisma.scheduledMessage.delete({ where: { id } });
    return reply.status(204).send();
  });

  // ── reminders ─────────────────────────────────────────────────────────
  fastify.post("/reminders", async (request, reply) => {
    const userId = request.user!.id;
    const input = parseOrThrow(createReminderSchema, request.body);

    const message = await fastify.prisma.message.findUnique({ where: { id: input.messageId } });
    if (!message || message.deletedAt) notFound("Wiadomość nie istnieje");
    await assertChannelMember(fastify, userId, message.channelId);

    if (new Date(input.remindAt).getTime() <= Date.now()) {
      return sendError(reply, 400, "REMIND_AT_IN_PAST", "Czas przypomnienia musi być w przyszłości");
    }

    const row = await fastify.prisma.reminder.create({
      data: {
        userId,
        messageId: input.messageId,
        channelId: message.channelId,
        note: input.note ?? null,
        remindAt: new Date(input.remindAt)
      }
    });
    return reply.status(201).send(toReminderDto(row));
  });

  fastify.get("/me/reminders", async (request) => {
    const rows = await fastify.prisma.reminder.findMany({
      where: { userId: request.user!.id, sentAt: null },
      orderBy: { remindAt: "asc" }
    });
    return rows.map(toReminderDto);
  });

  fastify.delete("/reminders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await fastify.prisma.reminder.findUnique({ where: { id } });
    if (!row || row.userId !== request.user!.id) notFound("Przypomnienie nie istnieje");
    await fastify.prisma.reminder.delete({ where: { id } });
    return reply.status(204).send();
  });

  // ── polls ─────────────────────────────────────────────────────────────
  async function toPollDto(pollId: string, viewerId: string): Promise<PollDto> {
    const poll = await fastify.prisma.poll.findUniqueOrThrow({
      where: { id: pollId },
      include: { options: { include: { votes: true }, orderBy: { position: "asc" } } }
    });
    const options = poll.options.map((o) => ({
      id: o.id,
      text: o.text,
      votes: o.votes.length,
      votedByMe: o.votes.some((v) => v.userId === viewerId)
    }));
    return {
      id: poll.id,
      messageId: poll.messageId,
      question: poll.question,
      allowMultiple: poll.allowMultiple,
      closesAt: poll.closesAt?.toISOString() ?? null,
      totalVotes: options.reduce((sum, o) => sum + o.votes, 0),
      options
    };
  }

  fastify.post("/channels/:channelId/polls", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(createPollSchema, { ...(request.body as object), channelId });
    await assertChannelMember(fastify, userId, channelId);

    const message = await fastify.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { channelId, authorId: userId, content: input.question, contentType: "poll" }
      });
      await tx.poll.create({
        data: {
          messageId: created.id,
          question: input.question,
          allowMultiple: input.allowMultiple,
          closesAt: input.closesAt ? new Date(input.closesAt) : null,
          options: {
            create: input.options.map((text, position) => ({ text, position }))
          }
        }
      });
      return created;
    });

    fastify.wsBroadcastNewMessage?.({
      id: message.id,
      channelId,
      authorId: userId,
      content: message.content,
      contentType: "poll",
      parentId: null,
      editedAt: null,
      createdAt: message.createdAt.toISOString()
    });

    return reply.status(201).send({ messageId: message.id });
  });

  fastify.get("/messages/:messageId/poll", async (request) => {
    const { messageId } = request.params as { messageId: string };
    const userId = request.user!.id;
    const message = await fastify.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) notFound("Wiadomość nie istnieje");
    await assertChannelMember(fastify, userId, message.channelId);

    const poll = await fastify.prisma.poll.findUnique({ where: { messageId } });
    if (!poll) notFound("Ankieta nie istnieje");
    return toPollDto(poll.id, userId);
  });

  fastify.post("/polls/:pollId/vote", async (request) => {
    const { pollId } = request.params as { pollId: string };
    const { optionId } = request.body as { optionId: string };
    const userId = request.user!.id;

    const poll = await fastify.prisma.poll.findUnique({ where: { id: pollId }, include: { message: true } });
    if (!poll) notFound("Ankieta nie istnieje");
    await assertChannelMember(fastify, userId, poll.message.channelId);

    const option = await fastify.prisma.pollOption.findFirst({ where: { id: optionId, pollId } });
    if (!option) notFound("Opcja nie istnieje");

    const existingVote = await fastify.prisma.pollVote.findUnique({
      where: { pollOptionId_userId: { pollOptionId: optionId, userId } }
    });

    if (existingVote) {
      await fastify.prisma.pollVote.delete({ where: { id: existingVote.id } });
    } else {
      if (!poll.allowMultiple) {
        // Single-choice: remove any other votes by this user on this poll first.
        await fastify.prisma.pollVote.deleteMany({
          where: { userId, option: { pollId } }
        });
      }
      await fastify.prisma.pollVote.create({ data: { pollOptionId: optionId, userId } });
    }

    const dto = await toPollDto(pollId, userId);
    fastify.wsBroadcastPollUpdate?.({ messageId: poll.messageId, channelId: poll.message.channelId, poll: dto });
    return dto;
  });
}
