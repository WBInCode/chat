import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import {
  searchQuerySchema,
  documentSearchQuerySchema,
  type SearchResultDto,
  type DocumentSearchResultDto
} from "@chatv2/shared";
import { parseOrThrow } from "../../lib/validation.js";
import { assertOrgMember } from "../../lib/authz.js";
import { assertModuleEnabled } from "../../lib/modules.js";

interface SearchRow {
  id: string;
  channelId: string;
  channelName: string | null;
  authorId: string;
  content: string;
  createdAt: Date;
}

interface DocumentRow {
  documentId: string;
  channelId: string;
  channelName: string | null;
  title: string;
  icon: string | null;
  snippet: string;
  updatedAt: Date;
}

export default async function searchRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  /**
   * Full-text search scoped to the user's channels in one org, with
   * optional structured filters (from:@user, in:#channel, has:file,
   * before/after) layered on top — parsed client-side into these params so
   * the server only deals with real IDs/dates, never fuzzy name matching.
   * Uses websearch_to_tsquery (accepts natural queries, quotes, -exclusions)
   * and only searches channels where the requester is a member — the join on
   * channel_members enforces authorization at the SQL level (no IDOR).
   */
  fastify.get("/search", async (request) => {
    const query = parseOrThrow(searchQuerySchema, request.query);
    const userId = request.user!.id;
    await assertOrgMember(fastify, userId, query.orgId);
    await assertModuleEnabled(fastify, query.orgId, "search");

    const conditions = [
      Prisma.sql`cm."userId" = ${userId}`,
      Prisma.sql`c."orgId" = ${query.orgId}`,
      Prisma.sql`m."deletedAt" IS NULL`,
      // E2E ciphertext and at-rest-encrypted rows are opaque to FTS — the
      // former must never be returned raw, the latter can never match.
      Prisma.sql`m."contentType" != 'e2e'`,
      Prisma.sql`m."encrypted" = false`
    ];
    if (query.q.length >= 2) {
      conditions.push(Prisma.sql`to_tsvector('simple', m.content) @@ websearch_to_tsquery('simple', ${query.q})`);
    }
    if (query.fromUserId) conditions.push(Prisma.sql`m."authorId" = ${query.fromUserId}`);
    if (query.channelId) conditions.push(Prisma.sql`m."channelId" = ${query.channelId}`);
    if (query.hasFile) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "files" f WHERE f."messageId" = m.id)`);
    if (query.before) conditions.push(Prisma.sql`m."createdAt" < ${new Date(query.before)}`);
    if (query.after) conditions.push(Prisma.sql`m."createdAt" > ${new Date(query.after)}`);

    const whereClause = Prisma.join(conditions, " AND ");

    const rows = await fastify.prisma.$queryRaw<SearchRow[]>`
      SELECT m.id            AS "id",
             m."channelId"   AS "channelId",
             c.name          AS "channelName",
             m."authorId"    AS "authorId",
             m.content       AS "content",
             m."createdAt"   AS "createdAt"
      FROM "messages" m
      JOIN "channels" c ON c.id = m."channelId"
      JOIN "channel_members" cm ON cm."channelId" = m."channelId"
      WHERE ${whereClause}
      ORDER BY m."createdAt" DESC
      LIMIT ${query.limit}
    `;

    const results: SearchResultDto[] = rows.map((r) => ({
      messageId: r.id,
      channelId: r.channelId,
      channelName: r.channelName,
      authorId: r.authorId,
      content: r.content,
      createdAt: r.createdAt.toISOString()
    }));

    return { results };
  });

  /**
   * Wyszukiwanie dokumentów. Świadomie `ILIKE`, a nie pełnotekstowe jak przy
   * wiadomościach: dokumentów jest mało, a szuka się ich zwykle po urywku
   * nazwy („raport" ma znaleźć „Raportowanie miesięczne"), czego konfiguracja
   * `simple` nie zrobi, bo nie sprowadza słów do rdzenia.
   *
   * Złączenie z `channel_members` ogranicza wynik do kanałów pytającego —
   * autoryzacja siedzi w zapytaniu, nie w kodzie nad nim.
   */
  fastify.get("/search/documents", async (request) => {
    const query = parseOrThrow(documentSearchQuerySchema, request.query);
    const userId = request.user!.id;
    await assertOrgMember(fastify, userId, query.orgId);
    await assertModuleEnabled(fastify, query.orgId, "search");
    await assertModuleEnabled(fastify, query.orgId, "documents");

    const wzorzec = `%${query.q.replace(/[\\%_]/g, (z) => `\\${z}`)}%`;
    const filtrKanalu = query.channelId
      ? Prisma.sql`AND d."channelId" = ${query.channelId}`
      : Prisma.empty;

    const rows = await fastify.prisma.$queryRaw<DocumentRow[]>`
      WITH tresci AS (
        SELECT d.id            AS "documentId",
               d."channelId"   AS "channelId",
               c.name          AS "channelName",
               d.title         AS "title",
               d.icon          AS "icon",
               d."updatedAt"   AS "updatedAt",
               b.position      AS "position",
               CASE b.type
                 WHEN 'heading' THEN b.data->>'text'
                 WHEN 'text'    THEN b.data->>'text'
                 WHEN 'checklist' THEN (
                   SELECT string_agg(i->>'text', ' ')
                   FROM jsonb_array_elements(b.data->'items') i
                 )
                 WHEN 'table' THEN (
                   SELECT string_agg(x, ' ') FROM (
                     SELECT jsonb_array_elements_text(b.data->'header') AS x
                     UNION ALL
                     SELECT jsonb_array_elements_text(r)
                     FROM jsonb_array_elements(b.data->'rows') r
                   ) komorki
                 )
                 ELSE NULL
               END AS "tresc"
        FROM "documents" d
        JOIN "channels" c ON c.id = d."channelId"
        JOIN "channel_members" cm ON cm."channelId" = d."channelId" AND cm."userId" = ${userId}
        LEFT JOIN "document_blocks" b ON b."documentId" = d.id
        WHERE d."orgId" = ${query.orgId} AND d."archivedAt" IS NULL ${filtrKanalu}
      ),
      trafienia AS (
        SELECT *, (title ILIKE ${wzorzec}) AS "wTytule"
        FROM tresci
        WHERE title ILIKE ${wzorzec} OR "tresc" ILIKE ${wzorzec}
      )
      SELECT * FROM (
        SELECT DISTINCT ON ("documentId")
               "documentId", "channelId", "channelName", "title", "icon", "updatedAt",
               COALESCE("tresc", "title") AS "snippet"
        FROM trafienia
        ORDER BY "documentId", "wTytule" DESC, "position" ASC NULLS LAST
      ) x
      ORDER BY x."updatedAt" DESC
      LIMIT ${query.limit}
    `;

    const results: DocumentSearchResultDto[] = rows.map((r) => ({
      documentId: r.documentId,
      channelId: r.channelId,
      channelName: r.channelName,
      title: r.title,
      icon: r.icon,
      snippet: r.snippet.length > 200 ? `${r.snippet.slice(0, 200)}…` : r.snippet,
      updatedAt: r.updatedAt.toISOString()
    }));

    return { results };
  });
}
