import type { FastifyInstance } from "fastify";
import {
  changeRoleSchema,
  setDeactivatedSchema,
  orgSettingsSchema,
  auditLogQuerySchema,
  setCustomRoleSchema
} from "@chatv2/shared";
import { parseOrThrow, sendError } from "../../lib/validation.js";
import { assertOrgPermission, assertOrgMember, forbidden, notFound, HttpError } from "../../lib/authz.js";
import { assertModuleEnabled } from "../../lib/modules.js";
import { logAudit, verifyAuditChain } from "../../lib/audit.js";
import { revokeSession } from "../../plugins/auth-guard.js";

export default async function adminRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return sendError(reply, error.status, error.code, error.message);
    }
    throw error;
  });

  // ── Members ──────────────────────────────────────────────────────────
  fastify.get("/orgs/:orgId/admin/members", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await assertOrgPermission(fastify, request.user!.id, orgId, "member.invite");

    const memberships = await fastify.prisma.membership.findMany({
      where: { orgId },
      include: { user: true },
      orderBy: { createdAt: "asc" }
    });

    return memberships.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      customRoleId: m.customRoleId,
      disabled: !!m.disabledAt,
      totpEnabled: m.user.totpEnabled,
      createdAt: m.createdAt.toISOString()
    }));
  });

  // ── Analytics ────────────────────────────────────────────────────────
  /** Workspace activity overview for admins (F6-I). */
  fastify.get("/orgs/:orgId/admin/analytics", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await assertOrgPermission(fastify, request.user!.id, orgId, "org.settings");
    await assertModuleEnabled(fastify, orgId, "analytics");

    const now = Date.now();
    const since7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [memberCount, channelCount, totalMessages, recent, topChannelsRaw] = await Promise.all([
      fastify.prisma.membership.count({ where: { orgId } }),
      fastify.prisma.channel.count({ where: { orgId } }),
      fastify.prisma.message.count({ where: { channel: { orgId }, deletedAt: null } }),
      // Last 7 days of messages (bounded, small for a company chat) — reused
      // for the daily buckets and the active-member count.
      fastify.prisma.message.findMany({
        where: { channel: { orgId }, deletedAt: null, createdAt: { gte: since7 } },
        select: { createdAt: true, authorId: true }
      }),
      fastify.prisma.message.groupBy({
        by: ["channelId"],
        where: { channel: { orgId }, deletedAt: null, createdAt: { gte: since30 } },
        _count: { _all: true },
        orderBy: { _count: { channelId: "desc" } },
        take: 5
      })
    ]);

    // Daily message counts for the last 7 days (oldest → newest).
    const days: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      days.push({ date: key, count: 0 });
    }
    const dayIndex = new Map(days.map((d, i) => [d.date, i]));
    for (const m of recent) {
      const key = m.createdAt.toISOString().slice(0, 10);
      const idx = dayIndex.get(key);
      if (idx !== undefined) days[idx]!.count += 1;
    }

    const activeMembers7d = new Set(recent.map((m) => m.authorId)).size;

    // Resolve channel names for the top channels.
    const topIds = topChannelsRaw.map((t) => t.channelId);
    const topChannelMeta = await fastify.prisma.channel.findMany({
      where: { id: { in: topIds } },
      select: { id: true, name: true, type: true }
    });
    const nameById = new Map(topChannelMeta.map((c) => [c.id, c]));
    const topChannels = topChannelsRaw
      .map((t) => {
        const meta = nameById.get(t.channelId);
        return {
          channelId: t.channelId,
          name: meta?.type === "DM" ? "Wiadomość bezpośrednia" : (meta?.name ?? "?"),
          messageCount: t._count._all
        };
      })
      // Hide DMs from the workspace overview (they're private).
      .filter((t) => nameById.get(t.channelId)?.type !== "DM");

    return {
      memberCount,
      channelCount,
      totalMessages,
      messages7d: recent.length,
      activeMembers7d,
      dailyMessages: days,
      topChannels
    };
  });

  fastify.patch("/orgs/:orgId/admin/members/:userId/custom-role", async (request, reply) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string };
    const actor = await assertOrgPermission(fastify, request.user!.id, orgId, "role.manage");
    const input = parseOrThrow(setCustomRoleSchema, request.body);

    const target = await fastify.prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId } } });
    if (!target) notFound("Członek nie istnieje");

    if (input.roleId) {
      const role = await fastify.prisma.role.findUnique({ where: { id: input.roleId } });
      if (!role || role.orgId !== orgId) notFound("Rola nie istnieje");
    }

    await fastify.prisma.membership.update({
      where: { userId_orgId: { userId, orgId } },
      data: { customRoleId: input.roleId }
    });

    await logAudit(fastify, {
      orgId,
      actorId: actor.userId,
      action: "member.custom_role_changed",
      meta: { targetUserId: userId, roleId: input.roleId },
      ip: request.ip
    });

    return reply.send({ ok: true });
  });

  fastify.patch("/orgs/:orgId/admin/members/:userId/role", async (request, reply) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string };
    const actor = await assertOrgPermission(fastify, request.user!.id, orgId, "member.changeRole");
    const input = parseOrThrow(changeRoleSchema, request.body);

    const target = await fastify.prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId } } });
    if (!target) notFound("Członek nie istnieje");
    if (target.role === "OWNER") forbidden("Nie można zmienić roli właściciela");

    await fastify.prisma.membership.update({
      where: { userId_orgId: { userId, orgId } },
      data: { role: input.role }
    });

    await logAudit(fastify, {
      orgId,
      actorId: actor.userId,
      action: "member.role_changed",
      meta: { targetUserId: userId, from: target.role, to: input.role },
      ip: request.ip
    });

    return reply.send({ ok: true });
  });

  fastify.patch("/orgs/:orgId/admin/members/:userId/deactivate", async (request, reply) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string };
    const actor = await assertOrgPermission(fastify, request.user!.id, orgId, "member.deactivate");
    const input = parseOrThrow(setDeactivatedSchema, request.body);

    const target = await fastify.prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId } } });
    if (!target) notFound("Członek nie istnieje");
    if (target.role === "OWNER") forbidden("Nie można deaktywować właściciela");

    await fastify.prisma.membership.update({
      where: { userId_orgId: { userId, orgId } },
      data: { disabledAt: input.disabled ? new Date() : null }
    });

    if (input.disabled) {
      // Revoke all active refresh sessions immediately — deactivation must
      // take effect right away, not after the access token naturally expires.
      const sessions = await fastify.prisma.session.findMany({
        where: { userId, revokedAt: null }
      });
      await fastify.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      await Promise.all(
        sessions.map((s) => revokeSession(fastify, s.id, 60 * 60 * 24 * 14))
      );
    }

    await logAudit(fastify, {
      orgId,
      actorId: actor.userId,
      action: input.disabled ? "member.deactivated" : "member.reactivated",
      meta: { targetUserId: userId },
      ip: request.ip
    });

    return reply.send({ ok: true });
  });

  // ── Channels (admin overview) ────────────────────────────────────────
  fastify.get("/orgs/:orgId/admin/channels", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await assertOrgPermission(fastify, request.user!.id, orgId, "channel.manage");

    const channels = await fastify.prisma.channel.findMany({
      where: { orgId, type: { not: "DM" } },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: "asc" }
    });

    return channels.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      memberCount: c._count.members,
      archived: !!c.archivedAt,
      createdAt: c.createdAt.toISOString()
    }));
  });

  fastify.patch("/orgs/:orgId/admin/channels/:channelId/archive", async (request, reply) => {
    const { orgId, channelId } = request.params as { orgId: string; channelId: string };
    const actor = await assertOrgPermission(fastify, request.user!.id, orgId, "channel.manage");

    const channel = await fastify.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel || channel.orgId !== orgId) notFound("Kanał nie istnieje");

    const archived = !channel.archivedAt;
    await fastify.prisma.channel.update({
      where: { id: channelId },
      data: { archivedAt: archived ? new Date() : null }
    });

    await logAudit(fastify, {
      orgId,
      actorId: actor.userId,
      action: archived ? "channel.archived" : "channel.unarchived",
      meta: { channelId, name: channel.name },
      ip: request.ip
    });

    return reply.send({ ok: true, archived });
  });

  // ── Audit log ────────────────────────────────────────────────────────
  fastify.get("/orgs/:orgId/admin/audit", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const membership = await assertOrgPermission(fastify, request.user!.id, orgId, "org.auditLog");
    const query = parseOrThrow(auditLogQuerySchema, request.query);

    // HR sees everything except actions performed by admins/owner (keeps
    // admin-on-admin oversight actions restricted to admins themselves).
    const canSeeFull = membership.role === "OWNER" || membership.role === "ADMIN";
    const adminActorIds = canSeeFull
      ? []
      : (
          await fastify.prisma.membership.findMany({
            where: { orgId, role: { in: ["OWNER", "ADMIN"] } },
            select: { userId: true }
          })
        ).map((m) => m.userId);

    const rows = await fastify.prisma.auditLog.findMany({
      where: {
        orgId,
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.action ? { action: { contains: query.action } } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {})
              }
            }
          : {}),
        ...(canSeeFull ? {} : { actorId: { notIn: adminActorIds } })
      },
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const actorIds = [...new Set(page.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = await fastify.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, displayName: true }
    });
    const actorNameById = new Map(actors.map((a) => [a.id, a.displayName]));

    return {
      entries: page.map((r) => ({
        id: r.id,
        actorId: r.actorId,
        actorName: r.actorId ? (actorNameById.get(r.actorId) ?? "Usunięty użytkownik") : null,
        action: r.action,
        meta: r.meta as Record<string, unknown>,
        ip: r.ip,
        createdAt: r.createdAt.toISOString()
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null
    };
  });

  fastify.get("/orgs/:orgId/admin/audit/verify", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await assertOrgPermission(fastify, request.user!.id, orgId, "org.auditLogFull");
    return verifyAuditChain(fastify, orgId);
  });

  // ── Organization settings ────────────────────────────────────────────
  fastify.get("/orgs/:orgId/admin/settings", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await assertOrgPermission(fastify, request.user!.id, orgId, "org.settings");
    const org = await fastify.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) notFound("Organizacja nie istnieje");
    return {
      require2fa: org.require2fa,
      messageRetentionDays: org.messageRetentionDays,
      allowedEmailDomains: org.allowedEmailDomains
    };
  });

  fastify.patch("/orgs/:orgId/admin/settings", async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const actor = await assertOrgPermission(fastify, request.user!.id, orgId, "org.settings");
    const input = parseOrThrow(orgSettingsSchema, request.body);

    const updated = await fastify.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(input.require2fa !== undefined ? { require2fa: input.require2fa } : {}),
        ...(input.messageRetentionDays !== undefined
          ? { messageRetentionDays: input.messageRetentionDays }
          : {}),
        ...(input.allowedEmailDomains !== undefined
          ? { allowedEmailDomains: input.allowedEmailDomains }
          : {})
      }
    });

    await logAudit(fastify, {
      orgId,
      actorId: actor.userId,
      action: "org.settings_updated",
      meta: input as Record<string, unknown>,
      ip: request.ip
    });

    return reply.send({
      require2fa: updated.require2fa,
      messageRetentionDays: updated.messageRetentionDays,
      allowedEmailDomains: updated.allowedEmailDomains
    });
  });

  // ── Dashboard ────────────────────────────────────────────────────────
  fastify.get("/orgs/:orgId/admin/dashboard", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await assertOrgPermission(fastify, request.user!.id, orgId, "org.auditLog");

    const cacheKey = `admin-dashboard:${orgId}`;
    const cached = await fastify.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const [totalMembers, activeMembers7d, totalFiles, recentEvents] = await Promise.all([
      fastify.prisma.membership.count({ where: { orgId, disabledAt: null } }),
      fastify.prisma.message.groupBy({
        by: ["authorId"],
        where: { channel: { orgId }, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } }
      }),
      fastify.prisma.file.count({ where: { orgId } }),
      fastify.prisma.auditLog.findMany({
        where: {
          orgId,
          action: { in: ["login.failed", "file.infected", "auth.refresh_reuse_detected"] }
        },
        orderBy: { createdAt: "desc" },
        take: 10
      })
    ]);

    // 30-day message histogram via a single grouped raw query (cheap, one
    // index scan) rather than 30 separate count() calls.
    const histogramRows = await fastify.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT date_trunc('day', m."createdAt") AS day, COUNT(*) AS count
      FROM "messages" m
      JOIN "channels" c ON c.id = m."channelId"
      WHERE c."orgId" = ${orgId}
        AND m."createdAt" >= NOW() - INTERVAL '30 days'
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    const byDay = new Map(histogramRows.map((r) => [r.day.toISOString().slice(0, 10), Number(r.count)]));
    const messagesLast30d: number[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      messagesLast30d.push(byDay.get(d as string) ?? 0);
    }

    const result = {
      totalMembers,
      activeMembers7d: activeMembers7d.length,
      messagesLast30d,
      totalFiles,
      recentSecurityEvents: recentEvents.map((r) => ({
        id: r.id,
        actorId: r.actorId,
        actorName: null,
        action: r.action,
        meta: r.meta as Record<string, unknown>,
        ip: r.ip,
        createdAt: r.createdAt.toISOString()
      }))
    };

    await fastify.redis.set(cacheKey, JSON.stringify(result), "EX", 300);
    return result;
  });
}
