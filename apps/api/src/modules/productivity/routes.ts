import type { FastifyInstance } from "fastify";
import {
  scheduleMessageSchema,
  createReminderSchema,
  createPollSchema,
  votePollSchema,
  POLL_VOTER_PREVIEW,
  type ScheduledMessageDto,
  type ReminderDto,
  type PollDto,
  type PollVoterDto,
  type PollVotersDto
} from "@chatv2/shared";
import { parseOrThrow } from "../../lib/validation.js";
import { assertChannelMember, notFound, forbidden, HttpError } from "../../lib/authz.js";
import { assertModuleEnabled } from "../../lib/modules.js";
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
    const membership = await assertChannelMember(fastify, userId, channelId);
    await assertModuleEnabled(fastify, membership.channel.orgId, "scheduling");

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
    const membership = await assertChannelMember(fastify, userId, message.channelId);
    await assertModuleEnabled(fastify, membership.channel.orgId, "reminders");

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

  /**
   * A poll is over once it was closed by hand or its deadline passed. Resolved
   * server-side and shipped as a plain boolean so the client never has to
   * compare timestamps against a clock we do not control.
   */
  function isClosed(poll: { closedAt: Date | null; closesAt: Date | null }): boolean {
    if (poll.closedAt) return true;
    return poll.closesAt !== null && poll.closesAt.getTime() <= Date.now();
  }

  function toVoterDto(user: { id: string; displayName: string; avatarUrl: string | null }): PollVoterDto {
    return { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl };
  }

  /**
   * The poll author and channel admins may end a poll early. Org-level admins
   * are deliberately not special-cased: in a private channel they are not
   * members at all, so channel membership is the honest boundary here.
   */
  function canClosePoll(authorId: string, viewerId: string, channelRole: string): boolean {
    return authorId === viewerId || channelRole === "ADMIN";
  }

  async function toPollDto(pollId: string, viewerId: string, channelRole: string): Promise<PollDto> {
    const poll = await fastify.prisma.poll.findUniqueOrThrow({
      where: { id: pollId },
      include: {
        message: { select: { authorId: true } },
        options: {
          orderBy: { position: "asc" },
          include: {
            votes: {
              orderBy: { createdAt: "asc" },
              include: { user: { select: { id: true, displayName: true, avatarUrl: true } } }
            }
          }
        }
      }
    });

    const options = poll.options.map((o) => ({
      id: o.id,
      text: o.text,
      emoji: o.emoji,
      votes: o.votes.length,
      votedByMe: o.votes.some((v) => v.userId === viewerId),
      voterPreview: poll.hideVoters
        ? []
        : o.votes.slice(0, POLL_VOTER_PREVIEW).map((v) => toVoterDto(v.user))
    }));

    // With multi-choice, ballots outnumber people. Percentages in the UI are
    // per person, so the distinct count has to be computed, not summed.
    const distinctVoters = new Set<string>();
    for (const option of poll.options) {
      for (const vote of option.votes) distinctVoters.add(vote.userId);
    }

    return {
      id: poll.id,
      messageId: poll.messageId,
      authorId: poll.message.authorId,
      question: poll.question,
      allowMultiple: poll.allowMultiple,
      hideVoters: poll.hideVoters,
      closesAt: poll.closesAt?.toISOString() ?? null,
      closedAt: poll.closedAt?.toISOString() ?? null,
      closed: isClosed(poll),
      totalVotes: options.reduce((sum, o) => sum + o.votes, 0),
      voterCount: distinctVoters.size,
      canClose: !isClosed(poll) && canClosePoll(poll.message.authorId, viewerId, channelRole),
      options
    };
  }

  /**
   * Loads a poll together with the caller's channel membership, rejecting
   * non-members before anything about the poll is revealed.
   */
  async function loadPollForViewer(pollId: string, viewerId: string) {
    const poll = await fastify.prisma.poll.findUnique({
      where: { id: pollId },
      include: { message: true }
    });
    if (!poll) notFound("Ankieta nie istnieje");
    const membership = await assertChannelMember(fastify, viewerId, poll.message.channelId);
    return { poll, membership };
  }

  fastify.post("/channels/:channelId/polls", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(createPollSchema, { ...(request.body as object), channelId });
    const membership = await assertChannelMember(fastify, userId, channelId);
    await assertModuleEnabled(fastify, membership.channel.orgId, "polls");

    if (input.closesAt && new Date(input.closesAt).getTime() <= Date.now()) {
      return sendError(reply, 400, "CLOSES_AT_IN_PAST", "Termin zakończenia musi być w przyszłości");
    }

    const message = await fastify.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { channelId, authorId: userId, content: input.question, contentType: "poll" }
      });
      await tx.poll.create({
        data: {
          messageId: created.id,
          question: input.question,
          allowMultiple: input.allowMultiple,
          hideVoters: input.hideVoters,
          closesAt: input.closesAt ? new Date(input.closesAt) : null,
          options: {
            create: input.options.map((option, position) => ({
              text: option.text,
              emoji: option.emoji ?? null,
              position
            }))
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
    const membership = await assertChannelMember(fastify, userId, message.channelId);

    const poll = await fastify.prisma.poll.findUnique({ where: { messageId } });
    if (!poll) notFound("Ankieta nie istnieje");
    return toPollDto(poll.id, userId, membership.role);
  });

  fastify.post("/polls/:pollId/vote", async (request, reply) => {
    const { pollId } = request.params as { pollId: string };
    const userId = request.user!.id;
    const { optionId } = parseOrThrow(votePollSchema, request.body);
    const { poll, membership } = await loadPollForViewer(pollId, userId);

    if (isClosed(poll)) {
      return sendError(reply, 409, "POLL_CLOSED", "Ankieta została zakończona");
    }

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

    const dto = await toPollDto(pollId, userId, membership.role);
    fastify.wsBroadcastPollUpdate?.({ messageId: poll.messageId, channelId: poll.message.channelId, poll: dto });
    return dto;
  });

  /** Ends a poll early. Idempotent: closing an already closed poll is a no-op. */
  fastify.post("/polls/:pollId/close", async (request, reply) => {
    const { pollId } = request.params as { pollId: string };
    const userId = request.user!.id;
    const { poll, membership } = await loadPollForViewer(pollId, userId);

    if (!canClosePoll(poll.message.authorId, userId, membership.role)) {
      forbidden("Tylko autor ankiety lub administrator kanału może ją zakończyć");
    }

    if (!isClosed(poll)) {
      await fastify.prisma.poll.update({ where: { id: pollId }, data: { closedAt: new Date() } });
    }

    const dto = await toPollDto(pollId, userId, membership.role);
    fastify.wsBroadcastPollUpdate?.({ messageId: poll.messageId, channelId: poll.message.channelId, poll: dto });
    return reply.send(dto);
  });

  /**
   * Full voter lists, grouped by option. Loaded on demand by the "who voted"
   * panel. Refused outright when the poll was created with hidden voters —
   * the promise made at creation time is enforced here, not in the UI.
   */
  fastify.get("/polls/:pollId/voters", async (request) => {
    const { pollId } = request.params as { pollId: string };
    const userId = request.user!.id;
    const { poll } = await loadPollForViewer(pollId, userId);

    if (poll.hideVoters) {
      forbidden("Ta ankieta ukrywa, kto jak zagłosował");
    }

    const options = await fastify.prisma.pollOption.findMany({
      where: { pollId },
      orderBy: { position: "asc" },
      include: {
        votes: {
          orderBy: { createdAt: "asc" },
          include: { user: { select: { id: true, displayName: true, avatarUrl: true } } }
        }
      }
    });

    const result: PollVotersDto = {
      pollId,
      options: options.map((o) => ({
        optionId: o.id,
        voters: o.votes.map((v) => toVoterDto(v.user))
      }))
    };
    return result;
  });
}
