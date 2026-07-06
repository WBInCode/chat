import type { FastifyInstance } from "fastify";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createOrgSchema, inviteSchema } from "@chatv2/shared";
import { parseOrThrow, sendError } from "../../lib/validation.js";
import { assertOrgAdmin, assertOrgMember, notFound } from "../../lib/authz.js";
import { generateRefreshToken, hashToken } from "../../lib/tokens.js";
import { logAudit } from "../../lib/audit.js";
import { s3 } from "../../lib/s3.js";
import { env } from "../../config/env.js";

export default async function orgRoutes(fastify: FastifyInstance) {
  // All org routes require authentication.
  fastify.addHook("preHandler", fastify.authenticate);

  /** List organizations the current user belongs to. */
  fastify.get("/", async (request) => {
    const memberships = await fastify.prisma.membership.findMany({
      where: { userId: request.user!.id },
      include: { org: true },
      orderBy: { createdAt: "asc" }
    });

    return memberships.map((m) => ({
      id: m.org.id,
      name: m.org.name,
      slug: m.org.slug,
      role: m.role
    }));
  });

  /** Create an organization; creator becomes OWNER and gets a #general channel. */
  fastify.post("/", async (request, reply) => {
    const input = parseOrThrow(createOrgSchema, request.body);
    const userId = request.user!.id;

    const existing = await fastify.prisma.organization.findUnique({
      where: { slug: input.slug }
    });
    if (existing) {
      return sendError(reply, 409, "SLUG_TAKEN", "Ta nazwa (slug) jest już zajęta");
    }

    const org = await fastify.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { name: input.name, slug: input.slug }
      });
      await tx.membership.create({
        data: { userId, orgId: created.id, role: "OWNER" }
      });
      const general = await tx.channel.create({
        data: { orgId: created.id, type: "PUBLIC", name: "general", createdBy: userId }
      });
      await tx.channelMember.create({
        data: { channelId: general.id, userId, role: "ADMIN" }
      });
      return created;
    });

    // Logged after the transaction commits: the hash chain reads the
    // latest row from the DB, so it must see a consistent, committed state.
    await logAudit(fastify, { orgId: org.id, actorId: userId, action: "org.create", ip: request.ip });

    return reply.status(201).send({ id: org.id, name: org.name, slug: org.slug, role: "OWNER" });
  });

  /** List members of an org. */
  fastify.get("/:orgId/members", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await assertOrgMember(fastify, request.user!.id, orgId);

    const members = await fastify.prisma.membership.findMany({
      where: { orgId },
      include: { user: { select: { id: true, email: true, displayName: true, avatarUrl: true } } },
      orderBy: { createdAt: "asc" }
    });

    return members.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
      role: m.role
    }));
  });

  /** Profile card popover data for a fellow org member (role, job title, status, etc). */
  fastify.get("/:orgId/members/:userId/profile", async (request) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string };
    await assertOrgMember(fastify, request.user!.id, orgId);
    const target = await fastify.prisma.membership.findUnique({
      where: { userId_orgId: { userId, orgId } },
      include: { user: true }
    });
    if (!target) notFound("Członek nie istnieje");

    const avatarUrl = target.user.avatarKey
      ? await getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: target.user.avatarKey }), {
          expiresIn: 3600
        })
      : null;

    return {
      userId: target.user.id,
      displayName: target.user.displayName,
      email: target.user.email,
      role: target.role,
      jobTitle: target.user.jobTitle,
      department: target.user.department,
      phone: target.user.phone,
      statusText: target.user.statusText,
      statusEmoji: target.user.statusEmoji,
      avatarUrl
    };
  });

  /** Create a one-time invite (admin only). Token returned once, only hash stored. */
  fastify.post("/:orgId/invites", async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const input = parseOrThrow(inviteSchema, request.body);
    await assertOrgAdmin(fastify, request.user!.id, orgId);

    const token = generateRefreshToken(); // 256-bit random, same generator
    const invite = await fastify.prisma.invite.create({
      data: {
        orgId,
        email: input.email,
        role: input.role === "OWNER" || !input.role ? "MEMBER" : input.role, // never invite as OWNER
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });

    await logAudit(fastify, {
      orgId,
      actorId: request.user!.id,
      action: "invite.create",
      meta: { email: input.email, role: invite.role },
      ip: request.ip
    });

    // Token zwracany JEDNORAZOWO — docelowo wysyłka mailem (BullMQ, faza 2).
    return reply.status(201).send({ inviteId: invite.id, token, expiresAt: invite.expiresAt });
  });
}

/** Separate route (no org prefix): accept an invite by token. */
export async function inviteAcceptRoute(fastify: FastifyInstance) {
  fastify.post(
    "/:token/accept",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const userId = request.user!.id;

      const invite = await fastify.prisma.invite.findUnique({
        where: { tokenHash: hashToken(token) }
      });

      if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
        return sendError(reply, 400, "INVALID_INVITE", "Zaproszenie jest nieważne lub wygasło");
      }

      const user = await fastify.prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.email !== invite.email) {
        return sendError(reply, 403, "INVITE_EMAIL_MISMATCH", "Zaproszenie dotyczy innego adresu email");
      }

      const existing = await fastify.prisma.membership.findUnique({
        where: { userId_orgId: { userId, orgId: invite.orgId } }
      });
      if (existing) {
        return sendError(reply, 409, "ALREADY_MEMBER", "Należysz już do tej organizacji");
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.membership.create({
          data: { userId, orgId: invite.orgId, role: invite.role }
        });
        await tx.invite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() }
        });
        // Auto-join all PUBLIC channels of the org.
        const publicChannels = await tx.channel.findMany({
          where: { orgId: invite.orgId, type: "PUBLIC" }
        });
        for (const ch of publicChannels) {
          await tx.channelMember.upsert({
            where: { channelId_userId: { channelId: ch.id, userId } },
            create: { channelId: ch.id, userId, role: "MEMBER" },
            update: {}
          });
        }
      });

      await logAudit(fastify, {
        orgId: invite.orgId,
        actorId: userId,
        action: "invite.accept",
        ip: request.ip
      });

      return reply.send({ orgId: invite.orgId });
    }
  );
}
