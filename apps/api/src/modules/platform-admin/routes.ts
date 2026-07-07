import type { FastifyInstance } from "fastify";
import { createPlatformOrgSchema, assignMembershipSchema } from "@chatv2/shared";
import { assertSuperAdmin, notFound, HttpError } from "../../lib/authz.js";
import { parseOrThrow, sendError } from "../../lib/validation.js";
import { logAudit } from "../../lib/audit.js";

/**
 * Platform-level super-admin panel (F5-H). Completely separate from the
 * per-org admin panel (modules/admin/routes.ts) — everything here operates
 * ACROSS organizations and requires `isSuperAdmin` (see lib/authz.ts),
 * never a regular org role. Primary use case: a self-registered account
 * has zero memberships until someone assigns it to an org (registration
 * intentionally does NOT auto-join anything — see PLAN.md).
 */
export default async function platformAdminRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return sendError(reply, error.status, error.code, error.message);
    }
    throw error;
  });

  fastify.addHook("preHandler", async (request) => {
    await assertSuperAdmin(fastify, request.user!.id);
  });

  fastify.get("/platform/users", async () => {
    const users = await fastify.prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: { memberships: { include: { org: true } } }
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      isSuperAdmin: u.isSuperAdmin,
      deletedAt: u.deletedAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      memberships: u.memberships.map((m) => ({
        orgId: m.orgId,
        orgName: m.org.name,
        role: m.role,
        disabled: !!m.disabledAt
      }))
    }));
  });

  fastify.get("/platform/orgs", async () => {
    const orgs = await fastify.prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { members: true, channels: true } } }
    });
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      memberCount: o._count.members,
      channelCount: o._count.channels,
      createdAt: o.createdAt.toISOString()
    }));
  });

  fastify.post("/platform/orgs", async (request, reply) => {
    const actor = await assertSuperAdmin(fastify, request.user!.id);
    const input = parseOrThrow(createPlatformOrgSchema, request.body);

    const existing = await fastify.prisma.organization.findUnique({ where: { slug: input.slug } });
    if (existing) {
      return sendError(reply, 409, "SLUG_TAKEN", "Organizacja z tym identyfikatorem już istnieje");
    }

    const org = await fastify.prisma.organization.create({ data: { name: input.name, slug: input.slug } });

    await logAudit(fastify, {
      orgId: org.id,
      actorId: actor.id,
      action: "platform.org_created",
      meta: { name: org.name, slug: org.slug },
      ip: request.ip
    });

    return reply.status(201).send({ id: org.id, name: org.name, slug: org.slug });
  });

  // Assign (or change) a user's role in an org — upsert semantics, since the
  // most common case is "this freshly-registered user has no membership
  // anywhere yet". PUBLIC-channel auto-join mirrors the invite-accept flow
  // (orgs/routes.ts) so a newly-assigned member can immediately see/use the
  // org's open channels instead of landing in an empty sidebar.
  fastify.post("/platform/memberships", async (request, reply) => {
    const actor = await assertSuperAdmin(fastify, request.user!.id);
    const input = parseOrThrow(assignMembershipSchema, request.body);

    const [user, org] = await Promise.all([
      fastify.prisma.user.findUnique({ where: { id: input.userId } }),
      fastify.prisma.organization.findUnique({ where: { id: input.orgId } })
    ]);
    if (!user) notFound("Użytkownik nie istnieje");
    if (!org) notFound("Organizacja nie istnieje");

    const membership = await fastify.prisma.membership.upsert({
      where: { userId_orgId: { userId: input.userId, orgId: input.orgId } },
      update: { role: input.role, disabledAt: null },
      create: { userId: input.userId, orgId: input.orgId, role: input.role }
    });

    const publicChannels = await fastify.prisma.channel.findMany({
      where: { orgId: input.orgId, type: "PUBLIC" }
    });
    for (const ch of publicChannels) {
      await fastify.prisma.channelMember.upsert({
        where: { channelId_userId: { channelId: ch.id, userId: input.userId } },
        update: {},
        create: { channelId: ch.id, userId: input.userId, role: "MEMBER" }
      });
    }

    await logAudit(fastify, {
      orgId: input.orgId,
      actorId: actor.id,
      action: "platform.membership_assigned",
      meta: { targetUserId: input.userId, role: input.role },
      ip: request.ip
    });

    return reply.status(201).send({
      userId: membership.userId,
      orgId: membership.orgId,
      role: membership.role,
      joinedPublicChannels: publicChannels.length
    });
  });

  fastify.delete("/platform/memberships/:userId/:orgId", async (request, reply) => {
    const actor = await assertSuperAdmin(fastify, request.user!.id);
    const { userId, orgId } = request.params as { userId: string; orgId: string };

    const membership = await fastify.prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId } } });
    if (!membership) notFound("Członkostwo nie istnieje");

    await fastify.prisma.$transaction([
      fastify.prisma.channelMember.deleteMany({ where: { userId, channel: { orgId } } }),
      fastify.prisma.membership.delete({ where: { userId_orgId: { userId, orgId } } })
    ]);

    await logAudit(fastify, {
      orgId,
      actorId: actor.id,
      action: "platform.membership_removed",
      meta: { targetUserId: userId },
      ip: request.ip
    });

    return reply.status(204).send();
  });
}
