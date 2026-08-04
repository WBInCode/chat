import type { FastifyInstance } from "fastify";
import type { MessageDto } from "@chatv2/shared";
import {
  createSystemNoticeSourceSchema,
  updateSystemNoticeSourceSchema,
  systemNoticePayloadSchema,
  type SystemNoticeSourceDto,
  type SystemNoticePayload
} from "@chatv2/shared";
import { assertOrgPermission, notFound } from "../../lib/authz.js";
import { assertModuleEnabled, isModuleEnabled } from "../../lib/modules.js";
import { parseOrThrow, sendError } from "../../lib/validation.js";
import { generateRefreshToken, hashToken } from "../../lib/tokens.js";
import { logAudit } from "../../lib/audit.js";
import { encryptMessageContent, isOrgEncryptedAtRest } from "../../lib/message-crypto.js";
import { sendPushToUser } from "../../lib/push.js";

const SYSTEM_BOT_EMAIL = "system@chatv2.system";
const SYSTEM_BOT_DISPLAY_NAME = "System";

/**
 * Konto techniczne występujące jako nadawca powiadomień. Hasło nie jest
 * poprawnym skrótem Argon2id, więc zalogowanie się na nie jest niemożliwe.
 */
export async function ensureSystemBotUser(fastify: FastifyInstance) {
  const existing = await fastify.prisma.user.findUnique({ where: { email: SYSTEM_BOT_EMAIL } });
  if (existing) return existing;
  return fastify.prisma.user.create({
    data: {
      email: SYSTEM_BOT_EMAIL,
      displayName: SYSTEM_BOT_DISPLAY_NAME,
      passwordHash: "!disabled-system-account!",
      totpEnabled: false
    }
  });
}

/**
 * Rozmowa danej osoby z nadawcą System. Zakładana leniwie, przy pierwszym
 * powiadomieniu, żeby nie tworzyć pustych rozmów wszystkim z góry.
 *
 * Kanał jest oznaczony jako tylko do odczytu: to jednostronny strumień
 * powiadomień, a nie rozmowa, więc odpowiedź nie miałaby do kogo trafić.
 */
async function ensureSystemChannel(fastify: FastifyInstance, orgId: string, userId: string, botId: string) {
  const existing = await fastify.prisma.channel.findFirst({
    where: {
      orgId,
      type: "DM",
      readOnly: true,
      AND: [
        { members: { some: { userId } } },
        { members: { some: { userId: botId } } },
        { members: { none: { userId: { notIn: [userId, botId] } } } }
      ]
    }
  });
  if (existing) return existing;

  return fastify.prisma.$transaction(async (tx) => {
    const created = await tx.channel.create({
      data: { orgId, type: "DM", readOnly: true, createdBy: botId }
    });
    await tx.channelMember.createMany({
      data: [
        { channelId: created.id, userId, role: "MEMBER" },
        { channelId: created.id, userId: botId, role: "MEMBER" }
      ]
    });
    return created;
  });
}

/**
 * Składa powiadomienie w treść wiadomości. Adres wstawiamy goły, bo renderer
 * zamienia w odnośnik same adresy http(s), a składni `[tekst](adres)` nie zna.
 */
function zlozTresc(label: string, input: SystemNoticePayload): string {
  const czesci = [`**${input.title}**`, `_${label}_`];
  if (input.body) czesci.push(input.body);
  if (input.url) czesci.push(input.url);
  return czesci.join("\n\n").slice(0, 4000);
}

function toDto(row: {
  id: string;
  key: string;
  label: string;
  enabled: boolean;
  noticeCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
}): SystemNoticeSourceDto {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    enabled: row.enabled,
    noticeCount: row.noticeCount,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
}

/** Zarządzanie źródłami. Wymaga zalogowania i uprawnień administratora. */
export default async function systemNoticeRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/orgs/:orgId/system-notice-sources", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await assertOrgPermission(fastify, request.user!.id, orgId, "org.settings");
    const rows = await fastify.prisma.systemNoticeSource.findMany({
      where: { orgId },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(toDto);
  });

  fastify.post("/orgs/:orgId/system-notice-sources", async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const userId = request.user!.id;
    await assertOrgPermission(fastify, userId, orgId, "org.settings");
    await assertModuleEnabled(fastify, orgId, "system-notices");
    const input = parseOrThrow(createSystemNoticeSourceSchema, request.body);

    const duplicate = await fastify.prisma.systemNoticeSource.findUnique({
      where: { orgId_key: { orgId, key: input.key } }
    });
    if (duplicate) {
      return sendError(reply, 409, "SOURCE_EXISTS", "Źródło o tym kluczu już istnieje");
    }

    const token = generateRefreshToken();
    const created = await fastify.prisma.systemNoticeSource.create({
      data: {
        orgId,
        key: input.key,
        label: input.label,
        tokenHash: hashToken(token),
        createdById: userId
      }
    });

    await logAudit(fastify, {
      orgId,
      actorId: userId,
      action: "systemNotice.sourceCreated",
      meta: { sourceId: created.id, key: created.key },
      ip: request.ip
    });

    // Token pokazujemy wyłącznie w tej jednej odpowiedzi: w bazie leży sam skrót.
    return reply.status(201).send({ ...toDto(created), token });
  });

  fastify.patch("/system-notice-sources/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await fastify.prisma.systemNoticeSource.findUnique({ where: { id } });
    if (!row) notFound("Źródło nie istnieje");
    await assertOrgPermission(fastify, request.user!.id, row.orgId, "org.settings");
    const input = parseOrThrow(updateSystemNoticeSourceSchema, request.body);

    const updated = await fastify.prisma.systemNoticeSource.update({
      where: { id },
      data: { enabled: input.enabled }
    });
    return reply.send(toDto(updated));
  });

  fastify.delete("/system-notice-sources/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await fastify.prisma.systemNoticeSource.findUnique({ where: { id } });
    if (!row) notFound("Źródło nie istnieje");
    const userId = request.user!.id;
    await assertOrgPermission(fastify, userId, row.orgId, "org.settings");

    await fastify.prisma.systemNoticeSource.delete({ where: { id } });
    await logAudit(fastify, {
      orgId: row.orgId,
      actorId: userId,
      action: "systemNotice.sourceDeleted",
      meta: { sourceId: id, key: row.key },
      ip: request.ip
    });
    return reply.status(204).send();
  });
}

/**
 * Wejście dla aplikacji ekosystemu. Bez sesji użytkownika: uwierzytelnia
 * wyłącznie nieodgadywalny token w adresie, tak samo jak webhooki
 * przychodzące. W bazie trzymamy sam skrót tokenu.
 */
export async function systemNoticeIngestRoute(fastify: FastifyInstance) {
  fastify.post(
    "/system-notices/:token",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { token } = request.params as { token: string };

      const source = await fastify.prisma.systemNoticeSource.findUnique({
        where: { tokenHash: hashToken(token) }
      });
      if (!source || !source.enabled) {
        return sendError(reply, 404, "NOT_FOUND", "Źródło nie istnieje lub jest wyłączone");
      }
      if (!(await isModuleEnabled(fastify, source.orgId, "system-notices"))) {
        return sendError(
          reply,
          403,
          "MODULE_DISABLED",
          "Moduł powiadomień systemowych jest wyłączony dla tej organizacji"
        );
      }

      const input = parseOrThrow(systemNoticePayloadSchema, request.body);

      // Adresy spoza organizacji pomijamy zamiast odrzucać całą paczkę:
      // aplikacja źródłowa nie musi wiedzieć, kto ma dostęp do czatu.
      const adresy = [...new Set(input.recipients.map((e) => e.toLowerCase()))];
      const odbiorcy = await fastify.prisma.user.findMany({
        where: {
          email: { in: adresy },
          deletedAt: null,
          memberships: { some: { orgId: source.orgId, disabledAt: null } }
        },
        select: { id: true }
      });
      if (odbiorcy.length === 0) {
        return reply.status(202).send({ ok: true, delivered: 0, skipped: adresy.length });
      }

      const bot = await ensureSystemBotUser(fastify);
      const tresc = zlozTresc(source.label, input);
      const encryptAtRest = await isOrgEncryptedAtRest(fastify, source.orgId);

      for (const odbiorca of odbiorcy) {
        const channel = await ensureSystemChannel(fastify, source.orgId, odbiorca.id, bot.id);
        const message = await fastify.prisma.message.create({
          data: {
            channelId: channel.id,
            authorId: bot.id,
            content: encryptAtRest ? encryptMessageContent(tresc) : tresc,
            encrypted: encryptAtRest,
            contentType: "text"
          }
        });

        const dto: MessageDto = {
          id: message.id,
          channelId: channel.id,
          authorId: bot.id,
          content: tresc,
          contentType: "text",
          parentId: null,
          editedAt: null,
          createdAt: message.createdAt.toISOString(),
          pinnedAt: null
        };
        fastify.wsBroadcastNewMessage?.(dto);

        await sendPushToUser(fastify, odbiorca.id, {
          title: `System: ${input.title}`,
          body: input.body.slice(0, 120) || source.label,
          channelId: channel.id,
          messageId: message.id
        }).catch((err) => fastify.log.warn({ err }, "Powiadomienie push nie zostało wysłane"));
      }

      await fastify.prisma.systemNoticeSource.update({
        where: { id: source.id },
        data: { noticeCount: { increment: odbiorcy.length }, lastUsedAt: new Date() }
      });

      return reply
        .status(202)
        .send({ ok: true, delivered: odbiorcy.length, skipped: adresy.length - odbiorcy.length });
    }
  );
}
