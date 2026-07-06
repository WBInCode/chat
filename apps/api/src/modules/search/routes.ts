import type { FastifyInstance } from "fastify";
import { searchQuerySchema, type SearchResultDto } from "@chatv2/shared";
import { parseOrThrow } from "../../lib/validation.js";
import { assertOrgMember } from "../../lib/authz.js";

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
   * Full-text search scoped to the user's channels in one org.
   * Uses websearch_to_tsquery (accepts natural queries, quotes, -exclusions)
   * and only searches channels where the requester is a member — the join on
   * channel_members enforces authorization at the SQL level (no IDOR).
   */
  fastify.get("/search", async (request) => {
    const query = parseOrThrow(searchQuerySchema, request.query);
    const userId = request.user!.id;
    await assertOrgMember(fastify, userId, query.orgId);

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
      WHERE cm."userId" = ${userId}
        AND c."orgId" = ${query.orgId}
        AND m."deletedAt" IS NULL
        AND to_tsvector('simple', m.content) @@ websearch_to_tsquery('simple', ${query.q})
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
