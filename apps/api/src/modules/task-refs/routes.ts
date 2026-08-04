import type { FastifyInstance } from "fastify";
import {
  createTaskSourceSchema,
  updateTaskSourceSchema,
  taskProviderResponseSchema,
  buildTaskUrl,
  sanitizeTaskRefTitle,
  type TaskSourceDto,
  type TaskSourceLinkDto,
  type TaskSearchResult
} from "@chatv2/shared";
import { assertOrgMember, assertOrgPermission, notFound } from "../../lib/authz.js";
import { assertModuleEnabled, isModuleEnabled } from "../../lib/modules.js";
import { parseOrThrow, sendError } from "../../lib/validation.js";
import { encryptField, decryptField } from "../../lib/field-crypto.js";
import { logAudit } from "../../lib/audit.js";

/** Aplikacja źródłowa dostaje krótki limit czasu — podpowiedzi mają nadążać za pisaniem. */
const LIMIT_CZASU_MS = 3000;

interface TaskSourceRow {
  id: string;
  key: string;
  label: string;
  searchUrl: string;
  taskUrlTemplate: string;
  enabled: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}

function toDto(row: TaskSourceRow): TaskSourceDto {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    searchUrl: row.searchUrl,
    taskUrlTemplate: row.taskUrlTemplate,
    enabled: row.enabled,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
}

/**
 * Pyta jedną aplikację o zadania danej osoby. Nigdy nie rzuca: jedno niedostępne
 * źródło nie może pozbawić podpowiedzi z pozostałych.
 */
async function zapytajZrodlo(
  fastify: FastifyInstance,
  source: { id: string; key: string; label: string; searchUrl: string; secretEnc: string; taskUrlTemplate: string },
  email: string,
  fraza: string
): Promise<TaskSearchResult[]> {
  try {
    const adres = new URL(source.searchUrl);
    adres.searchParams.set("email", email);
    adres.searchParams.set("q", fraza);
    adres.searchParams.set("limit", "10");

    const odpowiedz = await fetch(adres, {
      headers: { "x-wb-task-secret": decryptField(source.secretEnc) },
      signal: AbortSignal.timeout(LIMIT_CZASU_MS)
    });
    if (!odpowiedz.ok) {
      // Adresu nie logujemy — niesie sekret w konfiguracji źródła.
      fastify.log.warn({ source: source.key, status: odpowiedz.status }, "Źródło zadań odrzuciło zapytanie");
      return [];
    }

    const dane = taskProviderResponseSchema.safeParse(await odpowiedz.json());
    if (!dane.success) {
      fastify.log.warn({ source: source.key }, "Źródło zadań odpowiedziało w nieznanym formacie");
      return [];
    }

    return dane.data.tasks.map((zadanie) => ({
      sourceKey: source.key,
      sourceLabel: source.label,
      id: zadanie.id,
      title: sanitizeTaskRefTitle(zadanie.title),
      status: zadanie.status ?? null,
      url: buildTaskUrl(source.taskUrlTemplate, zadanie.id)
    }));
  } catch (err) {
    fastify.log.warn({ err, source: source.key }, "Nie udało się zapytać źródła zadań");
    return [];
  }
}

export default async function taskRefRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/orgs/:orgId/task-sources", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await assertOrgPermission(fastify, request.user!.id, orgId, "org.settings");
    const rows = await fastify.prisma.taskSource.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
    return rows.map(toDto);
  });

  fastify.post("/orgs/:orgId/task-sources", async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const userId = request.user!.id;
    await assertOrgPermission(fastify, userId, orgId, "org.settings");
    await assertModuleEnabled(fastify, orgId, "task-refs");
    const input = parseOrThrow(createTaskSourceSchema, request.body);

    const duplikat = await fastify.prisma.taskSource.findUnique({
      where: { orgId_key: { orgId, key: input.key } }
    });
    if (duplikat) return sendError(reply, 409, "SOURCE_EXISTS", "Źródło o tym kluczu już istnieje");

    const created = await fastify.prisma.taskSource.create({
      data: {
        orgId,
        key: input.key,
        label: input.label,
        searchUrl: input.searchUrl,
        secretEnc: encryptField(input.secret),
        taskUrlTemplate: input.taskUrlTemplate,
        createdById: userId
      }
    });

    await logAudit(fastify, {
      orgId,
      actorId: userId,
      action: "taskSource.created",
      meta: { sourceId: created.id, key: created.key },
      ip: request.ip
    });
    return reply.status(201).send(toDto(created));
  });

  fastify.patch("/task-sources/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await fastify.prisma.taskSource.findUnique({ where: { id } });
    if (!row) notFound("Źródło nie istnieje");
    await assertOrgPermission(fastify, request.user!.id, row.orgId, "org.settings");
    const input = parseOrThrow(updateTaskSourceSchema, request.body);

    const updated = await fastify.prisma.taskSource.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.searchUrl !== undefined ? { searchUrl: input.searchUrl } : {}),
        ...(input.taskUrlTemplate !== undefined ? { taskUrlTemplate: input.taskUrlTemplate } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.secret !== undefined ? { secretEnc: encryptField(input.secret) } : {})
      }
    });
    return reply.send(toDto(updated));
  });

  fastify.delete("/task-sources/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await fastify.prisma.taskSource.findUnique({ where: { id } });
    if (!row) notFound("Źródło nie istnieje");
    const userId = request.user!.id;
    await assertOrgPermission(fastify, userId, row.orgId, "org.settings");

    await fastify.prisma.taskSource.delete({ where: { id } });
    await logAudit(fastify, {
      orgId: row.orgId,
      actorId: userId,
      action: "taskSource.deleted",
      meta: { sourceId: id, key: row.key },
      ip: request.ip
    });
    return reply.status(204).send();
  });

  /**
   * Wzory adresów dla klienta. Plakietka w wiadomości ma prowadzić do zadania
   * także wtedy, gdy czyta ją ktoś, kto sam nic nie wyszukiwał.
   */
  fastify.get("/orgs/:orgId/task-source-links", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await assertOrgMember(fastify, request.user!.id, orgId);
    if (!(await isModuleEnabled(fastify, orgId, "task-refs"))) return [] as TaskSourceLinkDto[];

    const rows = await fastify.prisma.taskSource.findMany({
      where: { orgId, enabled: true },
      select: { key: true, label: true, taskUrlTemplate: true },
      orderBy: { createdAt: "asc" }
    });
    return rows satisfies TaskSourceLinkDto[];
  });

  /**
   * Podpowiedzi do pola wiadomości. Każde źródło samo ogranicza wynik do zadań
   * widocznych dla pytającego — czat nie zna uprawnień w tamtych aplikacjach,
   * więc wysyła jego adres e-mail i ufa tej filtracji.
   */
  fastify.get(
    "/orgs/:orgId/task-search",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const userId = request.user!.id;
      await assertOrgMember(fastify, userId, orgId);
      await assertModuleEnabled(fastify, orgId, "task-refs");

      const { q } = request.query as { q?: string };
      const fraza = (q ?? "").trim().slice(0, 120);

      const sources = await fastify.prisma.taskSource.findMany({ where: { orgId, enabled: true } });
      if (sources.length === 0) return reply.send([]);

      const osoba = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (!osoba?.email) return reply.send([]);

      const wyniki = await Promise.all(
        sources.map((source) => zapytajZrodlo(fastify, source, osoba.email, fraza))
      );

      await fastify.prisma.taskSource.updateMany({
        where: { id: { in: sources.map((s) => s.id) } },
        data: { lastUsedAt: new Date() }
      });

      return reply.send(wyniki.flat().slice(0, 20));
    }
  );
}
