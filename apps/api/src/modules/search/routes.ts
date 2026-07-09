import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { searchQuerySchema, type SearchResultDto } from "@chatv2/shared";
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

    const conditions = [Prisma.sql`cm."userId" = ${userId}`, Prisma.sql`c."orgId" = ${query.orgId}`, Prisma.sql`m."deletedAt" IS NULL`];
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
}
