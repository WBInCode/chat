import type { FastifyInstance } from "fastify";
import type { MessageDto } from "@chatv2/shared";
import {
  createIntegrationWebhookSchema,
  setIntegrationWebhookEnabledSchema,
  incomingWebhookPayloadSchema,
  type IntegrationWebhookDto
} from "@chatv2/shared";
import { assertOrgPermission, assertChannelMember, notFound } from "../../lib/authz.js";
import { assertModuleEnabled, isModuleEnabled } from "../../lib/modules.js";
import { parseOrThrow, sendError } from "../../lib/validation.js";
import { generateRefreshToken, hashToken } from "../../lib/tokens.js";
import { logAudit } from "../../lib/audit.js";

const INTEGRATION_BOT_EMAIL = "integrations@chatv2.system";
const INTEGRATION_BOT_DISPLAY_NAME = "Integracje";

async function ensureIntegrationBotUser(fastify: FastifyInstance) {
  let bot = await fastify.prisma.user.findUnique({ where: { email: INTEGRATION_BOT_EMAIL } });
  if (!bot) {
    bot = await fastify.prisma.user.create({
      data: {
        email: INTEGRATION_BOT_EMAIL,
        displayName: INTEGRATION_BOT_DISPLAY_NAME,
        passwordHash: "!disabled-system-account!", // never a valid Argon2id hash — login is impossible
        totpEnabled: false
      }
    });
  }
  return bot;
}

async function ensureBotChannelMembership(fastify: FastifyInstance, botUserId: string, channelId: string) {
  const existing = await fastify.prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId: botUserId } }
  });
  if (!existing) {
    await fastify.prisma.channelMember.create({ data: { channelId, userId: botUserId, role: "MEMBER" } });
  }
}

function toDto(
  w: {
    id: string;
    channelId: string;
    name: string;
    enabled: boolean;
    messageCount: number;
    lastUsedAt: Date | null;
    createdAt: Date;
    channel?: { name: string | null } | null;
  },
  token?: string
): IntegrationWebhookDto {
  return {
    id: w.id,
    channelId: w.channelId,
    channelName: w.channel?.name ?? null,
    name: w.name,
    enabled: w.enabled,
    messageCount: w.messageCount,
    lastUsedAt: w.lastUsedAt?.toISOString() ?? null,
    createdAt: w.createdAt.toISOString(),
    ...(token ? { token } : {})
  };
}

/**
 * Authenticated CRUD for incoming integration webhooks (F7-I), gated behind
 * `channel.manage` (same bar as other channel-administration actions) and
 * the `integrations` module toggle.
 */
export default async function integrationsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/orgs/:orgId/integrations", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await assertOrgPermission(fastify, request.user!.id, orgId, "channel.manage");

    const rows = await fastify.prisma.integrationWebhook.findMany({
      where: { orgId },
      include: { channel: true },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((w) => toDto(w));
  });

  fastify.post("/orgs/:orgId/integrations", async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const actor = await assertOrgPermission(fastify, request.user!.id, orgId, "channel.manage");
    await assertModuleEnabled(fastify, orgId, "integrations");
    const input = parseOrThrow(createIntegrationWebhookSchema, request.body);

    const member = await assertChannelMember(fastify, request.user!.id, input.channelId);
    if (member.channel.orgId !== orgId) notFound("Kanał nie istnieje");

    const token = generateRefreshToken();
    const created = await fastify.prisma.integrationWebhook.create({
      data: {
        orgId,
        channelId: input.channelId,
        name: input.name,
        tokenHash: hashToken(token),
        createdById: request.user!.id
      },
      include: { channel: true }
    });

    await logAudit(fastify, {
      orgId,
      actorId: actor.userId,
      action: "integration.created",
      meta: { channelId: input.channelId, name: input.name },
      ip: request.ip
    });

    return reply.status(201).send(toDto(created, token));
  });

  fastify.patch("/integrations/:id", async (request) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(setIntegrationWebhookEnabledSchema, request.body);

    const webhook = await fastify.prisma.integrationWebhook.findUnique({ where: { id } });
    if (!webhook) notFound("Integracja nie istnieje");
    const actor = await assertOrgPermission(fastify, request.user!.id, webhook.orgId, "channel.manage");

    const updated = await fastify.prisma.integrationWebhook.update({
      where: { id },
      data: { enabled: input.enabled },
      include: { channel: true }
    });

    await logAudit(fastify, {
      orgId: webhook.orgId,
      actorId: actor.userId,
      action: "integration.toggled",
      meta: { id, enabled: input.enabled },
      ip: request.ip
    });

    return toDto(updated);
  });

  fastify.delete("/integrations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const webhook = await fastify.prisma.integrationWebhook.findUnique({ where: { id } });
    if (!webhook) notFound("Integracja nie istnieje");
    const actor = await assertOrgPermission(fastify, request.user!.id, webhook.orgId, "channel.manage");

    await fastify.prisma.integrationWebhook.delete({ where: { id } });

    await logAudit(fastify, {
      orgId: webhook.orgId,
      actorId: actor.userId,
      action: "integration.deleted",
      meta: { id, name: webhook.name },
      ip: request.ip
    });

    return reply.status(204).send();
  });
}

/**
 * Public, unauthenticated endpoint the external system POSTs to. Security
 * comes entirely from the unguessable bearer token in the URL (same model
 * as invite links / unsubscribe links) — its SHA-256 hash is looked up, the
 * plaintext is never stored or logged. Rate-limited tighter than the global
 * baseline since it's reachable without any chatv2 session.
 */
export async function incomingWebhookRoute(fastify: FastifyInstance) {
  fastify.post(
    "/webhooks/incoming/:token",
    {
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" }
      }
    },
    async (request, reply) => {
      const { token } = request.params as { token: string };

      const webhook = await fastify.prisma.integrationWebhook.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { channel: true }
      });
      if (!webhook || !webhook.enabled) {
        return sendError(reply, 404, "NOT_FOUND", "Webhook nie istnieje lub jest wyłączony");
      }
      if (!(await isModuleEnabled(fastify, webhook.orgId, "integrations"))) {
        return sendError(reply, 403, "MODULE_DISABLED", "Moduł integracji jest wyłączony dla tej organizacji");
      }

      const input = parseOrThrow(incomingWebhookPayloadSchema, request.body);

      const bot = await ensureIntegrationBotUser(fastify);
      await ensureBotChannelMembership(fastify, bot.id, webhook.channelId);

      const header = input.username ? `**${input.username.slice(0, 80)}**\n` : "";
      const attachments = (input.attachments ?? [])
        .map((a) => [a.title ? `**${a.title}**` : null, a.text ?? null].filter(Boolean).join("\n"))
        .filter(Boolean)
        .join("\n\n");
      const content = [header + input.text, attachments].filter(Boolean).join("\n\n").slice(0, 4000);

      const message = await fastify.prisma.message.create({
        data: { channelId: webhook.channelId, authorId: bot.id, content, contentType: "text" }
      });

      await fastify.prisma.integrationWebhook.update({
        where: { id: webhook.id },
        data: { messageCount: { increment: 1 }, lastUsedAt: new Date() }
      });

      const dto: MessageDto = {
        id: message.id,
        channelId: message.channelId,
        authorId: message.authorId,
        content: message.content,
        contentType: "text",
        parentId: null,
        editedAt: null,
        pinnedAt: null,
        createdAt: message.createdAt.toISOString(),
        files: [],
        embeds: [],
        reactions: [],
        replyCount: 0
      };
      fastify.wsBroadcastNewMessage?.(dto);

      return reply.status(202).send({ ok: true });
    }
  );
}
