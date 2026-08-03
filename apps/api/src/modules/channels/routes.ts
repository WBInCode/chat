import type { FastifyInstance } from "fastify";
import {
  createChannelSchema,
  createDmSchema,
  createGroupDmSchema,
  addChannelMemberSchema,
  setChannelMemberRoleSchema,
  setChannelTopicSchema,
  renameChannelSchema,
  setMutedSchema,
  setFavoriteSchema,
  setChannelTtlSchema,
  setChannelE2eSchema,
  updateChannelSchema,
  updateChannelLayoutSchema,
  createCategorySchema,
  updateCategorySchema
} from "@chatv2/shared";
import { parseOrThrow, sendError } from "../../lib/validation.js";
import {
  assertOrgMember,
  assertOrgPermission,
  hasOrgPermission,
  assertChannelMember,
  assertChannelAdmin,
  forbidden,
  notFound
} from "../../lib/authz.js";
import { assertModuleEnabled } from "../../lib/modules.js";
import { logAudit } from "../../lib/audit.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "../../lib/s3.js";
import { env } from "../../config/env.js";

/**
 * Kasuje obiekty w magazynie należące do kanału. Wywoływane PRZED usunięciem
 * wiersza kanału — kaskada w bazie zabrałaby klucze i bloby zostałyby
 * osierocone w S3 na zawsze.
 */async function purgeChannelFiles(fastify: FastifyInstance, channelId: string) {
  const files = await fastify.prisma.file.findMany({
    where: { channelId },
    select: { key: true, thumbKey: true, previewKey: true }
  });
  const keys = files.flatMap((f) => [f.key, f.thumbKey, f.previewKey]).filter((k): k is string => !!k);
  if (keys.length === 0) return 0;

  const results = await Promise.allSettled(
    keys.map((Key) => s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key })))
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    fastify.log.warn({ channelId, failed, total: keys.length }, "Część plików kanału została w magazynie");
  }
  return keys.length - failed;
}

/** Usuwa duplikaty zachowując kolejność. */
function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** Ile ze wskazanych osób faktycznie należy do organizacji. */
async function countOrgMembers(fastify: FastifyInstance, orgId: string, userIds: string[]) {
  return fastify.prisma.membership.count({
    where: { orgId, userId: { in: userIds }, disabledAt: null }
  });
}

function toCategoryDto(category: {
  id: string;
  orgId: string;
  name: string;
  position: number;
  private: boolean;
  members?: Array<{ userId: string }>;
}) {
  return {
    id: category.id,
    orgId: category.orgId,
    name: category.name,
    position: category.position,
    private: category.private,
    memberIds: (category.members ?? []).map((m) => m.userId)
  };
}

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
            category: { select: { id: true, name: true, position: true } },
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
      orderBy: [{ sortOrder: "asc" }, { channel: { createdAt: "asc" } }]
    });

    // Kolejność listy jest wspólna dla całej organizacji (jak w Discordzie):
    // najpierw pozycja kategorii, potem pozycja kanału w kategorii. Kanały bez
    // kategorii trafiają na górę. Rozmowy prywatne mają osobną sekcję w interfejsie,
    // więc ich kolejność zostaje przy dacie utworzenia.
    const ordered = [...memberships].sort((a, b) => {
      const ca = a.channel;
      const cb = b.channel;
      const catA = ca.category?.position ?? -1;
      const catB = cb.category?.position ?? -1;
      if (catA !== catB) return catA - catB;
      if (ca.position !== cb.position) return ca.position - cb.position;
      return ca.createdAt.getTime() - cb.createdAt.getTime();
    });

    return ordered.map((m) => {
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
        kind: ch.kind,
        name,
        topic: ch.topic,
        categoryId: ch.categoryId,
        position: ch.position,
        slowmodeSeconds: ch.slowmodeSeconds,
        createdBy: ch.createdBy,
        createdAt: ch.createdAt.toISOString(),
        lastReadAt: m.lastReadAt?.toISOString() ?? null,
        unreadCount,
        myRole: m.role,
        muted: !!m.mutedAt,
        favorite: m.favorite,
        archivedAt: ch.archivedAt?.toISOString() ?? null,
        e2ee: ch.e2ee,
        messageTtlSeconds: ch.messageTtlSeconds
      };
    });
  });

  /**
   * Układ listy kanałów wspólny dla całej organizacji — pozycje kategorii oraz
   * przypisanie i kolejność kanałów. Odpowiednik przeciągania w Discordzie.
   * Wymaga uprawnienia channel.manage, bo zmiana dotyka wszystkich w organizacji.
   */
  fastify.patch("/orgs/:orgId/channel-layout", async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const userId = request.user!.id;
    await assertOrgPermission(fastify, userId, orgId, "channel.manage");
    const input = parseOrThrow(updateChannelLayoutSchema, request.body);

    // Filtrujemy po orgId, żeby identyfikatorem z innej organizacji nie dało się
    // ani nic zmienić, ani wysondować istnienia zasobu.
    const [ownCategories, ownChannels] = await Promise.all([
      fastify.prisma.channelCategory.findMany({
        where: { orgId, id: { in: input.categories.map((c) => c.id) } },
        select: { id: true }
      }),
      fastify.prisma.channel.findMany({
        where: { orgId, type: { not: "DM" }, id: { in: input.channels.map((c) => c.id) } },
        select: { id: true }
      })
    ]);
    const categoryIds = new Set(ownCategories.map((c) => c.id));
    const channelIds = new Set(ownChannels.map((c) => c.id));

    // Kanał nie może trafić do kategorii spoza tej organizacji.
    const targetCategoryIds = input.channels
      .map((c) => c.categoryId)
      .filter((id): id is string => id !== null);
    if (targetCategoryIds.length > 0) {
      const valid = await fastify.prisma.channelCategory.findMany({
        where: { orgId, id: { in: targetCategoryIds } },
        select: { id: true, private: true }
      });
      const validIds = new Set(valid.map((c) => c.id));
      if (targetCategoryIds.some((id) => !validIds.has(id))) {
        return sendError(reply, 400, "CATEGORY_NOT_FOUND", "Wskazana kategoria nie istnieje");
      }

      // Publiczny kanał pod prywatnym nagłówkiem byłby dostępny dla całej
      // organizacji, więc przeciągnięcie go tam musi zostać odrzucone.
      const privateIds = new Set(valid.filter((c) => c.private).map((c) => c.id));
      if (privateIds.size > 0) {
        const movedToPrivate = input.channels
          .filter((c) => c.categoryId !== null && privateIds.has(c.categoryId))
          .map((c) => c.id);
        const publicMoved = await fastify.prisma.channel.count({
          where: { id: { in: movedToPrivate }, type: "PUBLIC" }
        });
        if (publicMoved > 0) {
          return sendError(
            reply,
            400,
            "CATEGORY_IS_PRIVATE",
            "Kanał publiczny nie może trafić do kategorii prywatnej"
          );
        }
      }
    }

    await fastify.prisma.$transaction([
      ...input.categories
        .filter((c) => categoryIds.has(c.id))
        .map((c) =>
          fastify.prisma.channelCategory.update({ where: { id: c.id }, data: { position: c.position } })
        ),
      ...input.channels
        .filter((c) => channelIds.has(c.id))
        .map((c) =>
          fastify.prisma.channel.update({
            where: { id: c.id },
            data: { categoryId: c.categoryId, position: c.position }
          })
        )
    ]);

    await logAudit(fastify, {
      orgId,
      actorId: userId,
      action: "channel.layoutChanged",
      meta: { categories: input.categories.length, channels: input.channels.length },
      ip: request.ip
    });

    fastify.io.to(`org:${orgId}`).emit("channels:layout-updated", { orgId });
    return reply.send({ ok: true });
  });

  /**
   * Lista kategorii kanałów organizacji. Kategorie prywatne widzą wyłącznie
   * ich członkowie oraz osoby z uprawnieniem channel.manage.
   */
  fastify.get("/orgs/:orgId/categories", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const userId = request.user!.id;
    await assertOrgMember(fastify, userId, orgId);
    const canManage = await hasOrgPermission(fastify, userId, orgId, "channel.manage");

    const categories = await fastify.prisma.channelCategory.findMany({
      where: canManage
        ? { orgId }
        : { orgId, OR: [{ private: false }, { members: { some: { userId } } }] },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: { members: { select: { userId: true } } }
    });
    return categories.map(toCategoryDto);
  });

  /** Utwórz kategorię (wymaga channel.manage). Nowa kategoria ląduje na końcu listy. */
  fastify.post("/orgs/:orgId/categories", async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const userId = request.user!.id;
    await assertOrgPermission(fastify, userId, orgId, "channel.manage");
    const input = parseOrThrow(createCategorySchema, request.body);

    const duplicate = await fastify.prisma.channelCategory.findFirst({ where: { orgId, name: input.name } });
    if (duplicate) {
      return sendError(reply, 409, "CATEGORY_EXISTS", "Kategoria o tej nazwie już istnieje");
    }

    // Twórca zawsze ma dostęp, inaczej mógłby ukryć kategorię sam przed sobą.
    const memberIds = input.private ? unique([userId, ...(input.memberIds ?? [])]) : [];
    if (memberIds.length > 0) {
      const valid = await countOrgMembers(fastify, orgId, memberIds);
      if (valid !== memberIds.length) {
        return sendError(reply, 400, "MEMBER_NOT_IN_ORG", "Wskazana osoba nie należy do tej organizacji");
      }
    }

    const last = await fastify.prisma.channelCategory.findFirst({
      where: { orgId },
      orderBy: { position: "desc" },
      select: { position: true }
    });
    const created = await fastify.prisma.channelCategory.create({
      data: {
        orgId,
        name: input.name,
        private: input.private,
        position: (last?.position ?? -1) + 1,
        members: { create: memberIds.map((id) => ({ userId: id })) }
      },
      include: { members: { select: { userId: true } } }
    });

    await logAudit(fastify, {
      orgId,
      actorId: userId,
      action: "category.created",
      meta: { categoryId: created.id, name: created.name, private: created.private },
      ip: request.ip
    });

    fastify.io.to(`org:${orgId}`).emit("channels:layout-updated", { orgId });
    return reply.code(201).send(toCategoryDto(created));
  });

  /** Zmień nazwę, prywatność lub listę osób kategorii (wymaga channel.manage). */
  fastify.patch("/categories/:categoryId", async (request, reply) => {
    const { categoryId } = request.params as { categoryId: string };
    const userId = request.user!.id;

    const category = await fastify.prisma.channelCategory.findUnique({ where: { id: categoryId } });
    if (!category) notFound("Kategoria nie istnieje");
    await assertOrgPermission(fastify, userId, category.orgId, "channel.manage");
    const input = parseOrThrow(updateCategorySchema, request.body);

    if (input.name !== undefined) {
      const duplicate = await fastify.prisma.channelCategory.findFirst({
        where: { orgId: category.orgId, name: input.name, id: { not: categoryId } }
      });
      if (duplicate) {
        return sendError(reply, 409, "CATEGORY_EXISTS", "Kategoria o tej nazwie już istnieje");
      }
    }

    const willBePrivate = input.private ?? category.private;

    // Publiczny kanał pod ukrytym nagłówkiem byłby widoczny dla całej
    // organizacji, więc kategoria prywatna nie może ich zawierać.
    if (willBePrivate) {
      const publicInside = await fastify.prisma.channel.count({
        where: { categoryId, type: "PUBLIC" }
      });
      if (publicInside > 0) {
        return sendError(
          reply,
          409,
          "CATEGORY_HAS_PUBLIC_CHANNELS",
          "Kategoria zawiera kanały publiczne. Zmień je na prywatne albo przenieś poza tę kategorię."
        );
      }
    }

    let memberIds: string[] | null = null;
    if (willBePrivate && input.memberIds !== undefined) {
      memberIds = unique([userId, ...input.memberIds]);
      const valid = await countOrgMembers(fastify, category.orgId, memberIds);
      if (valid !== memberIds.length) {
        return sendError(reply, 400, "MEMBER_NOT_IN_ORG", "Wskazana osoba nie należy do tej organizacji");
      }
    }

    const updated = await fastify.prisma.$transaction(async (tx) => {
      // Zdjęcie prywatności czyści listę — kategoria publiczna nie ma członków.
      if (input.private === false) {
        await tx.channelCategoryMember.deleteMany({ where: { categoryId } });
      } else if (memberIds) {
        await tx.channelCategoryMember.deleteMany({
          where: { categoryId, userId: { notIn: memberIds } }
        });
        await tx.channelCategoryMember.createMany({
          data: memberIds.map((id) => ({ categoryId, userId: id })),
          skipDuplicates: true
        });
      } else if (input.private === true) {
        // Włączenie prywatności bez podanej listy: dostęp dostaje autor zmiany.
        await tx.channelCategoryMember.createMany({
          data: [{ categoryId, userId }],
          skipDuplicates: true
        });
      }

      return tx.channelCategory.update({
        where: { id: categoryId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.private !== undefined ? { private: input.private } : {})
        },
        include: { members: { select: { userId: true } } }
      });
    });

    await logAudit(fastify, {
      orgId: category.orgId,
      actorId: userId,
      action: "category.updated",
      meta: { categoryId, name: updated.name, private: updated.private },
      ip: request.ip
    });

    fastify.io.to(`org:${category.orgId}`).emit("channels:layout-updated", { orgId: category.orgId });
    return reply.send(toCategoryDto(updated));
  });

  /**
   * Usuń kategorię (wymaga channel.manage). Kanały z tej kategorii NIE są usuwane —
   * lądują poza kategoriami, tak jak w Discordzie.
   */
  fastify.delete("/categories/:categoryId", async (request, reply) => {
    const { categoryId } = request.params as { categoryId: string };
    const userId = request.user!.id;

    const category = await fastify.prisma.channelCategory.findUnique({ where: { id: categoryId } });
    if (!category) notFound("Kategoria nie istnieje");
    await assertOrgPermission(fastify, userId, category.orgId, "channel.manage");

    // onDelete: SetNull na relacji zdejmuje przypisanie kanałów.
    await fastify.prisma.channelCategory.delete({ where: { id: categoryId } });

    await logAudit(fastify, {
      orgId: category.orgId,
      actorId: userId,
      action: "category.deleted",
      meta: { categoryId, name: category.name },
      ip: request.ip
    });

    fastify.io.to(`org:${category.orgId}`).emit("channels:layout-updated", { orgId: category.orgId });
    return reply.send({ ok: true });
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

    // Kategoria musi należeć do tej samej organizacji, inaczej kanał powstałby
    // od razu niewidoczny dla własnego zespołu.
    let categoryMemberIds: string[] = [];
    if (input.categoryId) {
      const category = await fastify.prisma.channelCategory.findUnique({
        where: { id: input.categoryId },
        select: { orgId: true, private: true, members: { select: { userId: true } } }
      });
      if (!category || category.orgId !== orgId) {
        return sendError(reply, 400, "CATEGORY_NOT_FOUND", "Wskazana kategoria nie istnieje");
      }
      if (category.private) {
        if (input.type !== "PRIVATE") {
          return sendError(
            reply,
            400,
            "CATEGORY_IS_PRIVATE",
            "W kategorii prywatnej można tworzyć wyłącznie kanały prywatne"
          );
        }
        // Kanał dziedziczy dostęp kategorii, inaczej jej członkowie widzieliby
        // nagłówek bez zawartości.
        categoryMemberIds = category.members.map((m) => m.userId);
      }
    }

    // Osoby wskazane przy tworzeniu kanału prywatnego. Kanał publiczny i tak
    // przyjmuje całą organizację, więc lista nie ma tam zastosowania.
    const invited =
      input.type === "PRIVATE"
        ? unique([...categoryMemberIds, ...(input.memberIds ?? [])]).filter((id) => id !== userId)
        : [];
    if (invited.length > 0) {
      const valid = await countOrgMembers(fastify, orgId, invited);
      if (valid !== invited.length) {
        return sendError(reply, 400, "MEMBER_NOT_IN_ORG", "Wskazana osoba nie należy do tej organizacji");
      }
    }

    // Nowy kanał ląduje na końcu swojej kategorii, tak jak w Discordzie.
    const last = await fastify.prisma.channel.findFirst({
      where: { orgId, categoryId: input.categoryId ?? null, type: { not: "DM" } },
      orderBy: { position: "desc" },
      select: { position: true }
    });

    const channel = await fastify.prisma.$transaction(async (tx) => {
      const created = await tx.channel.create({
        data: {
          orgId,
          type: input.type,
          kind: input.kind,
          name: input.name,
          createdBy: userId,
          categoryId: input.categoryId ?? null,
          position: (last?.position ?? -1) + 1
        }
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
      } else if (invited.length > 0) {
        await tx.channelMember.createMany({
          data: invited.map((id) => ({ channelId: created.id, userId: id, role: "MEMBER" as const })),
          skipDuplicates: true
        });
      }
      return created;
    });

    await logAudit(fastify, {
      orgId,
      actorId: userId,
      action: "channel.create",
      meta: { name: input.name, type: input.type, invited: invited.length },
      ip: request.ip
    });

    return reply.status(201).send({
      id: channel.id,
      orgId: channel.orgId,
      type: channel.type,
      kind: channel.kind,
      name: channel.name,
      categoryId: channel.categoryId,
      position: channel.position,
      slowmodeSeconds: channel.slowmodeSeconds,
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
    await assertChannelAdmin(fastify, userId, channelId, "Tylko administrator kanału może dodawać członków");

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

  /**
   * Per-member read state for a channel (read receipts, F6-C). Returns each
   * member's lastReadAt so clients can render "seen by" indicators. Only
   * accessible to channel members.
   */
  fastify.get("/channels/:channelId/read-state", async (request) => {
    const { channelId } = request.params as { channelId: string };
    await assertChannelMember(fastify, request.user!.id, channelId);

    const members = await fastify.prisma.channelMember.findMany({
      where: { channelId },
      select: { userId: true, lastReadAt: true }
    });

    return members.map((m) => ({
      userId: m.userId,
      lastReadAt: m.lastReadAt?.toISOString() ?? null
    }));
  });

  /**
   * Nadanie lub odebranie roli administratora kanału. Ma znaczenie zwłaszcza
   * w kanałach ogłoszeniowych, gdzie pisać mogą wyłącznie administratorzy.
   */
  fastify.patch("/channels/:channelId/members/:userId", async (request, reply) => {
    const { channelId, userId: targetUserId } = request.params as { channelId: string; userId: string };
    const actorId = request.user!.id;
    const input = parseOrThrow(setChannelMemberRoleSchema, request.body);

    const membership = await assertChannelMember(fastify, actorId, channelId);
    if (membership.channel.type === "DM") {
      return sendError(reply, 400, "DM_IMMUTABLE", "Rozmowa prywatna nie ma administratorów");
    }
    await assertChannelAdmin(fastify, actorId, channelId, "Tylko administrator kanału może zmieniać role");

    const target = await fastify.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: targetUserId } }
    });
    if (!target) notFound("Ta osoba nie należy do kanału");
    if (target.role === input.role) {
      return reply.send({ userId: targetUserId, role: target.role });
    }

    // Kanał bez administratora nie da się już edytować, a ogłoszeniowy traci
    // kogokolwiek, kto może w nim pisać.
    if (input.role === "MEMBER") {
      const admins = await fastify.prisma.channelMember.count({ where: { channelId, role: "ADMIN" } });
      if (admins <= 1) {
        return sendError(
          reply,
          409,
          "LAST_CHANNEL_ADMIN",
          "To jedyny administrator kanału. Najpierw wskaż kogoś innego."
        );
      }
    }

    const updated = await fastify.prisma.channelMember.update({
      where: { channelId_userId: { channelId, userId: targetUserId } },
      data: { role: input.role }
    });

    await logAudit(fastify, {
      orgId: membership.channel.orgId,
      actorId,
      action: "channel.member_role_changed",
      meta: { channelId, targetUserId, role: input.role },
      ip: request.ip
    });

    fastify.io.to(`org:${membership.channel.orgId}`).emit("channels:layout-updated", {
      orgId: membership.channel.orgId
    });
    return reply.send({ userId: updated.userId, role: updated.role });
  });

  /** Remove a member from a PUBLIC/PRIVATE channel (channel admin only, not DMs). */
  fastify.delete("/channels/:channelId/members/:userId", async (request, reply) => {
    const { channelId, userId: targetUserId } = request.params as { channelId: string; userId: string };
    const actorId = request.user!.id;

    const membership = await assertChannelMember(fastify, actorId, channelId);
    if (membership.channel.type === "DM") {
      return sendError(reply, 400, "DM_IMMUTABLE", "Nie można usuwać osób z rozmowy prywatnej");
    }
    await assertChannelAdmin(fastify, actorId, channelId, "Tylko administrator kanału może usuwać członków");
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
    await assertChannelAdmin(fastify, userId, channelId, "Tylko administrator kanału może zmienić temat");

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

  /**
   * Disappearing messages: set/clear the channel TTL. Channel ADMIN for
   * regular channels; in DMs (no admin role) any participant may set it,
   * mirroring consumer messengers. The change is broadcast so every open
   * client updates its header indicator immediately.
   */
  fastify.patch("/channels/:channelId/ttl", async (request) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(setChannelTtlSchema, request.body);

    const membership = await assertChannelMember(fastify, userId, channelId);
    if (membership.channel.type !== "DM") {
      await assertChannelAdmin(
        fastify,
        userId,
        channelId,
        "Tylko administrator kanału może zmienić znikanie wiadomości"
      );
    }

    const updated = await fastify.prisma.channel.update({
      where: { id: channelId },
      data: { messageTtlSeconds: input.messageTtlSeconds }
    });

    await logAudit(fastify, {
      orgId: membership.channel.orgId,
      actorId: userId,
      action: "channel.ttl_changed",
      meta: { channelId, messageTtlSeconds: input.messageTtlSeconds },
      ip: request.ip
    });

    fastify.wsBroadcastChannelSettings?.({ channelId, messageTtlSeconds: updated.messageTtlSeconds });

    return { channelId, messageTtlSeconds: updated.messageTtlSeconds };
  });

  /**
   * End-to-end encryption toggle for 1:1 DMs. Requires BOTH participants
   * to have published an identity key (X25519) — otherwise the peer could
   * never read anything. Disabling is allowed by either participant and
   * only affects NEW messages (already-sent ciphertext stays encrypted).
   */
  fastify.patch("/channels/:channelId/e2e", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(setChannelE2eSchema, request.body);

    const membership = await assertChannelMember(fastify, userId, channelId);
    if (membership.channel.type !== "DM") {
      return sendError(reply, 400, "E2E_DM_ONLY", "Szyfrowanie end-to-end jest dostępne tylko w rozmowach 1:1");
    }
    // Hub-governed entitlement: the e2ee module can be disabled centrally
    // from wb-platform (Entitlements API) — respect it before any toggle.
    if (input.enabled) {
      await assertModuleEnabled(fastify, membership.channel.orgId, "e2ee");
    }

    const members = await fastify.prisma.channelMember.findMany({
      where: { channelId },
      include: { user: { select: { id: true, publicKey: true } } }
    });
    if (members.length !== 2) {
      return sendError(reply, 400, "E2E_DM_ONLY", "Szyfrowanie end-to-end jest dostępne tylko w rozmowach 1:1");
    }
    if (input.enabled) {
      const missing = members.filter((m) => !m.user.publicKey);
      if (missing.length > 0) {
        return sendError(
          reply,
          409,
          "E2E_KEY_MISSING",
          "Obie osoby muszą mieć klucz szyfrowania. Poproś rozmówcę o otwarcie aplikacji."
        );
      }
    }

    const updated = await fastify.prisma.channel.update({
      where: { id: channelId },
      data: { e2ee: input.enabled }
    });

    await logAudit(fastify, {
      orgId: membership.channel.orgId,
      actorId: userId,
      action: input.enabled ? "channel.e2e_enabled" : "channel.e2e_disabled",
      meta: { channelId },
      ip: request.ip
    });

    // Invalidate the gateway's e2ee lookup cache so typing-indicator
    // suppression takes effect immediately, not after the TTL expires.
    await fastify.redis.del(`e2ee-channel:${channelId}`);

    fastify.wsBroadcastChannelSettings?.({ channelId, e2ee: updated.e2ee });

    return { channelId, e2ee: updated.e2ee };
  });

  /** Public identity keys of channel members (needed to encrypt/decrypt E2E DMs). */
  fastify.get("/channels/:channelId/e2e-keys", async (request) => {
    const { channelId } = request.params as { channelId: string };
    await assertChannelMember(fastify, request.user!.id, channelId);

    const members = await fastify.prisma.channelMember.findMany({
      where: { channelId },
      include: { user: { select: { id: true, publicKey: true } } }
    });

    return members.map((m) => ({ userId: m.user.id, publicKey: m.user.publicKey }));
  });

  /**
   * Zbiorcza edycja ustawień kanału (administrator kanału, bez rozmów prywatnych).
   * Obsługuje nazwę, temat, rodzaj kanału, slowmode i przypisanie do kategorii.
   * Zastępuje dawny endpoint zmieniający wyłącznie nazwę — stary kształt żądania
   * ({ name }) nadal działa, bo wszystkie pola są opcjonalne.
   */
  fastify.patch("/channels/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(updateChannelSchema, request.body);

    const membership = await assertChannelMember(fastify, userId, channelId);
    if (membership.channel.type === "DM") {
      return sendError(reply, 400, "DM_IMMUTABLE", "Nie można zmienić ustawień rozmowy prywatnej");
    }
    await assertChannelAdmin(fastify, userId, channelId, "Tylko administrator kanału może zmienić ustawienia");
    const orgId = membership.channel.orgId;

    if (input.name !== undefined) {
      const duplicate = await fastify.prisma.channel.findFirst({
        where: { orgId, name: input.name, type: { not: "DM" }, id: { not: channelId } }
      });
      if (duplicate) {
        return sendError(reply, 409, "CHANNEL_EXISTS", "Kanał o tej nazwie już istnieje");
      }
    }

    // Kategoria musi należeć do tej samej organizacji, inaczej kanał zniknąłby
    // z listy wszystkim członkom, a obcy administrator zyskałby nad nim wpływ.
    if (input.categoryId) {
      const category = await fastify.prisma.channelCategory.findUnique({
        where: { id: input.categoryId },
        select: { orgId: true, private: true }
      });
      if (!category || category.orgId !== orgId) {
        return sendError(reply, 400, "CATEGORY_NOT_FOUND", "Wskazana kategoria nie istnieje");
      }
      if (category.private && membership.channel.type === "PUBLIC") {
        return sendError(
          reply,
          400,
          "CATEGORY_IS_PRIVATE",
          "Kanał publiczny nie może trafić do kategorii prywatnej"
        );
      }
    }

    const updated = await fastify.prisma.channel.update({
      where: { id: channelId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.topic !== undefined ? { topic: input.topic } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.slowmodeSeconds !== undefined ? { slowmodeSeconds: input.slowmodeSeconds } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {})
      }
    });

    await logAudit(fastify, {
      orgId,
      actorId: userId,
      action: "channel.updated",
      meta: { channelId, changed: Object.keys(input) },
      ip: request.ip
    });

    fastify.io.to(`org:${orgId}`).emit("channels:layout-updated", { orgId });

    return {
      id: updated.id,
      name: updated.name,
      topic: updated.topic,
      kind: updated.kind,
      slowmodeSeconds: updated.slowmodeSeconds,
      categoryId: updated.categoryId
    };
  });

  /**
   * Trwałe usunięcie kanału wraz z całą historią. Do tej pory dostępna była
   * wyłącznie archiwizacja, przez co porzucone kanały zostawały na liście
   * na zawsze. Wymaga uprawnienia organizacji channel.manage, a nie samej roli
   * administratora kanału — skutki są nieodwracalne i dotyczą wszystkich.
   */
  fastify.delete("/channels/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;

    const membership = await assertChannelMember(fastify, userId, channelId);
    if (membership.channel.type === "DM") {
      return sendError(reply, 400, "DM_IMMUTABLE", "Nie można usunąć rozmowy prywatnej");
    }
    const orgId = membership.channel.orgId;
    await assertOrgPermission(fastify, userId, orgId, "channel.manage");

    const name = membership.channel.name;

    // Kasujemy pliki z magazynu przed usunięciem wierszy — kaskada w bazie
    // zabrałaby klucze obiektów i zostałyby osierocone bloby.
    await purgeChannelFiles(fastify, channelId).catch((err: unknown) =>
      fastify.log.warn({ err, channelId }, "Nie udało się usunąć plików kanału")
    );

    await fastify.prisma.channel.delete({ where: { id: channelId } });

    await logAudit(fastify, {
      orgId,
      actorId: userId,
      action: "channel.deleted",
      meta: { channelId, name },
      ip: request.ip
    });

    fastify.io.to(`org:${orgId}`).emit("channel:deleted", { channelId, orgId });
    return reply.send({ ok: true });
  });

  /** Archive/unarchive a channel (channel admin only). Archived channels stay readable but hidden by default. */
  fastify.post("/channels/:channelId/archive", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;

    const membership = await assertChannelMember(fastify, userId, channelId);
    if (membership.channel.type === "DM") {
      return sendError(reply, 400, "DM_IMMUTABLE", "Nie można zarchiwizować rozmowy prywatnej");
    }
    await assertChannelAdmin(fastify, userId, channelId, "Tylko administrator kanału może archiwizować");

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
    await assertChannelAdmin(fastify, userId, channelId, "Tylko administrator kanału może przywrócić kanał");

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
