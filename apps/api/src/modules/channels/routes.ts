import type { FastifyInstance } from "fastify";
import { createChannelSchema, createDmSchema, addChannelMemberSchema } from "@chatv2/shared";
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
      // For DMs, display name = the other participant's name.
      let name = ch.name;
      if (ch.type === "DM") {
        const other = ch.members.find((cm) => cm.userId !== userId);
        name = other?.user.displayName ?? "DM";
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
        createdBy: ch.createdBy,
        createdAt: ch.createdAt.toISOString(),
        lastReadAt: m.lastReadAt?.toISOString() ?? null,
        unreadCount
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
}
