import type { FastifyInstance } from "fastify";
import {
  createChannelSchema,
  createDmSchema,
  createGroupDmSchema,
  addChannelMemberSchema,
  setChannelTopicSchema,
  renameChannelSchema,
  setMutedSchema,
  setFavoriteSchema
} from "@chatv2/shared";
import { parseOrThrow, sendError } from "../../lib/validation.js";
import {
  assertOrgMember,
  assertChannelMember,
  forbidden,
  notFound
} from "../../lib/authz.js";
import { logAudit } from "../../lib/audit.js";

export default async function channelRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  /** List channels of an org visible to the user (member of channel). */
  fastify.get("/orgs/:orgId/channels", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const userId = request.user!.id;
    await assertOrgMember(fastify, userId, orgId);

    const memberships = await fastify.prisma.channelMember.findMany({
      where: { userId, channel: { orgId } },
      include: {
        channel: {
          include: {
            members: {
              include: { user: { select: { id: true, displayName: true } } }
            },
            // Only fields needed to compute unread counts, capped for safety.
            messages: {
              where: { deletedAt: null },
              select: { authorId: true, createdAt: true },
              orderBy: { createdAt: "desc" },
              take: 200
            }
          }
        }
      },
      orderBy: { channel: { createdAt: "asc" } }
    });

    return memberships.map((m) => {
      const ch = m.channel;
      // For DMs, display name = other participant(s)' name(s) (comma-joined for group DMs).
      let name = ch.name;
      if (ch.type === "DM") {
        const others = ch.members.filter((cm) => cm.userId !== userId);
        name = others.map((o) => o.user.displayName).join(", ") || "DM";
      }
      // Unread = messages authored by others after our lastReadAt.
      const lastRead = m.lastReadAt?.getTime() ?? 0;
      const unreadCount = ch.messages.filter(
        (msg) => msg.authorId !== userId && msg.createdAt.getTime() > lastRead
      ).length;
      return {
        id: ch.id,
        orgId: ch.orgId,
        type: ch.type,
        name,
        topic: ch.topic,
        createdBy: ch.createdBy,
        createdAt: ch.createdAt.toISOString(),
        lastReadAt: m.lastReadAt?.toISOString() ?? null,
        unreadCount,
        myRole: m.role,
        muted: !!m.mutedAt,
        favorite: m.favorite,
        archivedAt: ch.archivedAt?.toISOString() ?? null
      };
    });
  });

  /** Create a channel (PUBLIC joins everyone in org; PRIVATE only creator). */
  fastify.post("/orgs/:orgId/channels", async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(createChannelSchema, request.body);
    await assertOrgMember(fastify, userId, orgId);

    const duplicate = await fastify.prisma.channel.findFirst({
      where: { orgId, name: input.name, type: { not: "DM" } }
    });
    if (duplicate) {
      return sendError(reply, 409, "CHANNEL_EXISTS", "Kanał o tej nazwie już istnieje");
    }

    const channel = await fastify.prisma.$transaction(async (tx) => {
      const created = await tx.channel.create({
        data: { orgId, type: input.type, name: input.name, createdBy: userId }
      });
      await tx.channelMember.create({
        data: { channelId: created.id, userId, role: "ADMIN" }
      });
      if (input.type === "PUBLIC") {
        const orgMembers = await tx.membership.findMany({ where: { orgId } });
        await tx.channelMember.createMany({
          data: orgMembers
            .filter((m) => m.userId !== userId)
            .map((m) => ({ channelId: created.id, userId: m.userId, role: "MEMBER" as const })),
          skipDuplicates: true
        });
      }
      return created;
    });

    await logAudit(fastify, {
      orgId,
      actorId: userId,
      action: "channel.create",
      meta: { name: input.name, type: input.type },
      ip: request.ip
    });

    return reply.status(201).send({
      id: channel.id,
      orgId: channel.orgId,
      type: channel.type,
      name: channel.name,
      createdBy: channel.createdBy,
      createdAt: channel.createdAt.toISOString()
    });
  });

  /** Create (or return existing) DM between current user and target. */
  fastify.post("/orgs/:orgId/dm", async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(createDmSchema, request.body);

    await assertOrgMember(fastify, userId, orgId);
    await assertOrgMember(fastify, input.targetUserId, orgId).catch(() =>
      notFound("Użytkownik nie należy do tej organizacji")
    );

    if (input.targetUserId === userId) {
      return sendError(reply, 400, "SELF_DM", "Nie można utworzyć rozmowy z samym sobą");
    }

    // Find existing DM containing exactly these two users.
    const existing = await fastify.prisma.channel.findFirst({
      where: {
        orgId,
        type: "DM",
        AND: [
          { members: { some: { userId } } },
          { members: { some: { userId: input.targetUserId } } }
        ]
      }
    });
    if (existing) {
      return reply.send({ id: existing.id, orgId, type: "DM", createdAt: existing.createdAt.toISOString() });
    }

    const channel = await fastify.prisma.$transaction(async (tx) => {
      const created = await tx.channel.create({
        data: { orgId, type: "DM", createdBy: userId }
      });
      await tx.channelMember.createMany({
        data: [
          { channelId: created.id, userId, role: "MEMBER" },
          { channelId: created.id, userId: input.targetUserId, role: "MEMBER" }
        ]
      });
      return created;
    });

    return reply
      .status(201)
      .send({ id: channel.id, orgId, type: "DM", createdAt: channel.createdAt.toISOString() });
  });

  /** Create a group DM (3+ participants, no dedup — each click makes a new group). */
  fastify.post("/orgs/:orgId/group-dm", async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(createGroupDmSchema, request.body);
    await assertOrgMember(fastify, userId, orgId);

    const uniqueTargets = [...new Set(input.memberUserIds)].filter((id) => id !== userId);
    if (uniqueTargets.length < 2) {
      return sendError(reply, 400, "GROUP_DM_TOO_SMALL", "Grupa wymaga co najmniej 2 innych osób");
    }
    for (const targetId of uniqueTargets) {
      await assertOrgMember(fastify, targetId, orgId).catch(() =>
        notFound("Użytkownik nie należy do tej organizacji")
      );
    }

    const channel = await fastify.prisma.$transaction(async (tx) => {
      const created = await tx.channel.create({ data: { orgId, type: "DM", createdBy: userId } });
      await tx.channelMember.createMany({
        data: [
          { channelId: created.id, userId, role: "ADMIN" as const },
          ...uniqueTargets.map((id) => ({ channelId: created.id, userId: id, role: "MEMBER" as const }))
        ]
      });
      return created;
    });

    return reply
      .status(201)
      .send({ id: channel.id, orgId, type: "DM", createdAt: channel.createdAt.toISOString() });
  });

  /** Add a member to a PRIVATE channel (channel admin only). */
  fastify.post("/channels/:channelId/members", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(addChannelMemberSchema, request.body);

    const membership = await assertChannelMember(fastify, userId, channelId);
    if (membership.channel.type === "DM") {
      return sendError(reply, 400, "DM_IMMUTABLE", "Nie można dodawać osób do rozmowy prywatnej");
    }
    if (membership.role !== "ADMIN") {
      forbidden("Tylko administrator kanału może dodawać członków");
    }

    // Target must belong to the same org (membership chain check).
    await assertOrgMember(fastify, input.userId, membership.channel.orgId).catch(() =>
      notFound("Użytkownik nie należy do tej organizacji")
    );

    await fastify.prisma.channelMember.upsert({
      where: { channelId_userId: { channelId, userId: input.userId } },
      create: { channelId, userId: input.userId, role: "MEMBER" },
      update: {}
    });

    return reply.status(201).send({ ok: true });
  });

  /** List members of a channel (any member can view). */
  fastify.get("/channels/:channelId/members", async (request) => {
    const { channelId } = request.params as { channelId: string };
    await assertChannelMember(fastify, request.user!.id, channelId);

    const members = await fastify.prisma.channelMember.findMany({
      where: { channelId },
      include: { user: { select: { id: true, displayName: true, email: true } } },
      orderBy: { createdAt: "asc" }
    });

    return members.map((m) => ({
      userId: m.userId,
      displayName: m.user.displayName,
      email: m.user.email,
      role: m.role
    }));
  });

  /** Remove a member from a PUBLIC/PRIVATE channel (channel admin only, not DMs). */
  fastify.delete("/channels/:channelId/members/:userId", async (request, reply) => {
    const { channelId, userId: targetUserId } = request.params as { channelId: string; userId: string };
    const actorId = request.user!.id;

    const membership = await assertChannelMember(fastify, actorId, channelId);
    if (membership.channel.type === "DM") {
      return sendError(reply, 400, "DM_IMMUTABLE", "Nie można usuwać osób z rozmowy prywatnej");
    }
    if (membership.role !== "ADMIN") {
      forbidden("Tylko administrator kanału może usuwać członków");
    }
    if (targetUserId === actorId) {
      return sendError(reply, 400, "CANNOT_REMOVE_SELF", "Użyj opcji opuszczenia kanału");
    }

    await fastify.prisma.channelMember.deleteMany({ where: { channelId, userId: targetUserId } });

    await logAudit(fastify, {
      orgId: membership.channel.orgId,
      actorId,
      action: "channel.member_removed",
      meta: { channelId, targetUserId },
      ip: request.ip
    });

    return reply.status(204).send();
  });

  /** Channel topic/description (channel admin only). */
  fastify.patch("/channels/:channelId/topic", async (request) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(setChannelTopicSchema, request.body);

    const membership = await assertChannelMember(fastify, userId, channelId);
    if (membership.role !== "ADMIN") {
      forbidden("Tylko administrator kanału może zmienić temat");
    }

    const updated = await fastify.prisma.channel.update({
      where: { id: channelId },
      data: { topic: input.topic }
    });

    await logAudit(fastify, {
      orgId: membership.channel.orgId,
      actorId: userId,
      action: "channel.topic_changed",
      meta: { channelId, topic: input.topic },
      ip: request.ip
    });

    return { id: updated.id, topic: updated.topic };
  });

  /** Mute/unmute a channel for the current user only (no notifications/unread emphasis). */
  fastify.patch("/channels/:channelId/mute", async (request) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(setMutedSchema, request.body);
    await assertChannelMember(fastify, userId, channelId);

    await fastify.prisma.channelMember.update({
      where: { channelId_userId: { channelId, userId } },
      data: { mutedAt: input.muted ? new Date() : null }
    });

    return { channelId, muted: input.muted };
  });

  /** Star/unstar a channel for quick access, personal to the current user. */
  fastify.patch("/channels/:channelId/favorite", async (request) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(setFavoriteSchema, request.body);
    await assertChannelMember(fastify, userId, channelId);

    await fastify.prisma.channelMember.update({
      where: { channelId_userId: { channelId, userId } },
      data: { favorite: input.favorite }
    });

    return { channelId, favorite: input.favorite };
  });

  /** Rename a channel (channel admin only, PUBLIC/PRIVATE only). */
  fastify.patch("/channels/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(renameChannelSchema, request.body);

    const membership = await assertChannelMember(fastify, userId, channelId);
    if (membership.channel.type === "DM") {
      return sendError(reply, 400, "DM_IMMUTABLE", "Nie można zmienić nazwy rozmowy prywatnej");
    }
    if (membership.role !== "ADMIN") {
      forbidden("Tylko administrator kanału może zmienić nazwę");
    }

    const duplicate = await fastify.prisma.channel.findFirst({
      where: { orgId: membership.channel.orgId, name: input.name, type: { not: "DM" }, id: { not: channelId } }
    });
    if (duplicate) {
      return sendError(reply, 409, "CHANNEL_EXISTS", "Kanał o tej nazwie już istnieje");
    }

    const updated = await fastify.prisma.channel.update({ where: { id: channelId }, data: { name: input.name } });

    await logAudit(fastify, {
      orgId: membership.channel.orgId,
      actorId: userId,
      action: "channel.renamed",
      meta: { channelId, name: input.name },
      ip: request.ip
    });

    return { id: updated.id, name: updated.name };
  });

  /** Archive/unarchive a channel (channel admin only). Archived channels stay readable but hidden by default. */
  fastify.post("/channels/:channelId/archive", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;

    const membership = await assertChannelMember(fastify, userId, channelId);
    if (membership.channel.type === "DM") {
      return sendError(reply, 400, "DM_IMMUTABLE", "Nie można zarchiwizować rozmowy prywatnej");
    }
    if (membership.role !== "ADMIN") {
      forbidden("Tylko administrator kanału może archiwizować");
    }

    await fastify.prisma.channel.update({ where: { id: channelId }, data: { archivedAt: new Date() } });
    await logAudit(fastify, {
      orgId: membership.channel.orgId,
      actorId: userId,
      action: "channel.archived",
      meta: { channelId },
      ip: request.ip
    });

    return reply.send({ ok: true });
  });

  fastify.post("/channels/:channelId/unarchive", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;

    const membership = await assertChannelMember(fastify, userId, channelId);
    if (membership.role !== "ADMIN") {
      forbidden("Tylko administrator kanału może przywrócić kanał");
    }

    await fastify.prisma.channel.update({ where: { id: channelId }, data: { archivedAt: null } });
    await logAudit(fastify, {
      orgId: membership.channel.orgId,
      actorId: userId,
      action: "channel.unarchived",
      meta: { channelId },
      ip: request.ip
    });

    return reply.send({ ok: true });
  });

  /** Browse every PUBLIC channel in the org (including ones the user hasn't joined yet), to discover and join. */
  fastify.get("/orgs/:orgId/channels/browse", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const userId = request.user!.id;
    await assertOrgMember(fastify, userId, orgId);

    const channels = await fastify.prisma.channel.findMany({
      where: { orgId, type: "PUBLIC" },
      include: {
        members: { select: { userId: true } },
        _count: { select: { members: true } }
      },
      orderBy: { createdAt: "asc" }
    });

    return channels.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      topic: c.topic,
      memberCount: c._count.members,
      isMember: c.members.some((m) => m.userId === userId),
      archivedAt: c.archivedAt?.toISOString() ?? null
    }));
  });

  /** Self-service join for a PUBLIC channel (no admin action needed). */
  fastify.post("/channels/:channelId/join", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;

    const channel = await fastify.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) notFound("Kanał nie istnieje");
    if (channel.type !== "PUBLIC") {
      return sendError(reply, 400, "NOT_JOINABLE", "Można dołączać tylko do kanałów publicznych");
    }
    await assertOrgMember(fastify, userId, channel.orgId);

    await fastify.prisma.channelMember.upsert({
      where: { channelId_userId: { channelId, userId } },
      create: { channelId, userId, role: "MEMBER" },
      update: {}
    });

    return reply.status(201).send({ ok: true });
  });
}
