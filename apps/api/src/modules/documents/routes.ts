import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import {
  createDocumentSchema,
  updateDocumentSchema,
  createBlockSchema,
  updateBlockSchema,
  moveBlockSchema,
  toggleChecklistItemSchema,
  createCommentSchema,
  type DocumentCommentDto,
  type DocumentRevisionDto,
  type DocumentSummaryDto
} from "@chatv2/shared";
import { parseOrThrow, sendError } from "../../lib/validation.js";
import { assertChannelMember, notFound, forbidden, HttpError } from "../../lib/authz.js";
import { assertModuleEnabled } from "../../lib/modules.js";
import {
  assertNotLockedByOther,
  claimLock,
  listLocks,
  loadDocumentDto,
  maybeSnapshot,
  moveBlock,
  parseBlockData,
  positionAfter,
  releaseLock,
  toBlockDto,
  toCsv,
  toSummaryDto
} from "./service.js";

/**
 * Documents module (F8): shared, block-based documents attached to a channel.
 *
 * Authorization is deliberately simple and inherited: whoever can read the
 * channel can read and edit its documents. Introducing a second, per-document
 * permission layer would create two sources of truth about who sees what,
 * which is exactly how access-control bugs are born.
 */
export default async function documentRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return sendError(reply, error.status, error.code, error.message);
    }
    throw error;
  });

  /** Resolves a document plus the caller's channel membership, or 404s. */
  async function loadForViewer(documentId: string, userId: string) {
    const document = await fastify.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.archivedAt) notFound("Dokument nie istnieje");
    const membership = await assertChannelMember(fastify, userId, document.channelId);
    await assertModuleEnabled(fastify, document.orgId, "documents");
    return { document, membership };
  }

  async function broadcast(
    documentId: string,
    channelId: string,
    kind: "meta" | "block" | "structure" | "comments" | "deleted",
    actorId: string,
    block?: ReturnType<typeof toBlockDto>
  ) {
    fastify.wsBroadcastDocumentUpdate?.({
      documentId,
      channelId,
      kind,
      actorId,
      ...(block ? { block } : {})
    });
  }

  async function broadcastLocks(documentId: string, channelId: string) {
    const blocks = await fastify.prisma.documentBlock.findMany({
      where: { documentId },
      select: { id: true }
    });
    const locks = await listLocks(fastify, documentId, blocks.map((b) => b.id));
    fastify.wsBroadcastDocumentLocks?.({ documentId, channelId, locks });
  }

  // ── documents ───────────────────────────────────────────────────────────

  fastify.get("/channels/:channelId/documents", async (request) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;
    const membership = await assertChannelMember(fastify, userId, channelId);
    await assertModuleEnabled(fastify, membership.channel.orgId, "documents");

    const rows = await fastify.prisma.document.findMany({
      where: { channelId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { blocks: true } } }
    });

    // One grouped count instead of a query per document.
    const openComments = await fastify.prisma.documentComment.groupBy({
      by: ["documentId"],
      where: { documentId: { in: rows.map((r) => r.id) }, resolvedAt: null },
      _count: { _all: true }
    });
    const commentsByDoc = new Map(openComments.map((c) => [c.documentId, c._count._all]));

    const result: DocumentSummaryDto[] = rows.map((row) =>
      toSummaryDto({ ...row, openCommentCount: commentsByDoc.get(row.id) ?? 0 })
    );
    return result;
  });

  fastify.post("/channels/:channelId/documents", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(createDocumentSchema, request.body);
    const membership = await assertChannelMember(fastify, userId, channelId);
    await assertModuleEnabled(fastify, membership.channel.orgId, "documents");

    const document = await fastify.prisma.document.create({
      data: {
        orgId: membership.channel.orgId,
        channelId,
        title: input.title,
        icon: input.icon ?? null,
        createdBy: userId,
        // A blank page is intimidating; a heading gives an obvious starting point.
        blocks: {
          create: [
            {
              type: "heading",
              position: 1000,
              data: { type: "heading", text: input.title, level: 1 } as Prisma.InputJsonValue,
              updatedById: userId
            }
          ]
        }
      }
    });

    await broadcast(document.id, channelId, "structure", userId);
    return reply.status(201).send(await loadDocumentDto(fastify, document.id));
  });

  fastify.get("/documents/:documentId", async (request) => {
    const { documentId } = request.params as { documentId: string };
    await loadForViewer(documentId, request.user!.id);
    return loadDocumentDto(fastify, documentId);
  });

  fastify.patch("/documents/:documentId", async (request) => {
    const { documentId } = request.params as { documentId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(updateDocumentSchema, request.body);
    const { document } = await loadForViewer(documentId, userId);

    await fastify.prisma.document.update({
      where: { id: documentId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {})
      }
    });

    await broadcast(documentId, document.channelId, "meta", userId);
    return loadDocumentDto(fastify, documentId);
  });

  /**
   * Archives rather than hard-deletes: the author or a channel admin removes
   * it from the list, but the content stays recoverable in the database
   * instead of vanishing the moment somebody misclicks.
   */
  fastify.delete("/documents/:documentId", async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const userId = request.user!.id;
    const { document, membership } = await loadForViewer(documentId, userId);

    if (document.createdBy !== userId && membership.role !== "ADMIN") {
      forbidden("Dokument może usunąć jego autor lub administrator kanału");
    }

    await fastify.prisma.document.update({
      where: { id: documentId },
      data: { archivedAt: new Date() }
    });
    await broadcast(documentId, document.channelId, "deleted", userId);
    return reply.status(204).send();
  });

  // ── blocks ──────────────────────────────────────────────────────────────

  fastify.post("/documents/:documentId/blocks", async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(createBlockSchema, request.body);
    const { document } = await loadForViewer(documentId, userId);

    await maybeSnapshot(fastify, documentId, userId, "Dodanie elementu");
    const position = await positionAfter(fastify, documentId, input.afterBlockId ?? null);

    const block = await fastify.prisma.documentBlock.create({
      data: {
        documentId,
        type: input.data.type,
        position,
        data: input.data as Prisma.InputJsonValue,
        updatedById: userId
      }
    });
    await fastify.prisma.document.update({ where: { id: documentId }, data: { updatedAt: new Date() } });

    await broadcast(documentId, document.channelId, "structure", userId);
    return reply.status(201).send(toBlockDto(block));
  });

  fastify.patch("/documents/:documentId/blocks/:blockId", async (request, reply) => {
    const { documentId, blockId } = request.params as { documentId: string; blockId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(updateBlockSchema, request.body);
    const { document } = await loadForViewer(documentId, userId);

    const existing = await fastify.prisma.documentBlock.findFirst({ where: { id: blockId, documentId } });
    if (!existing) notFound("Element nie istnieje");
    await assertNotLockedByOther(fastify, documentId, blockId, userId);

    // Optimistic concurrency: the client says which version it edited. If the
    // stored version moved on, someone saved in the meantime and this write
    // would erase their work, so it is refused and the client re-syncs.
    if (existing.version !== input.version) {
      return sendError(
        reply,
        409,
        "BLOCK_VERSION_CONFLICT",
        "Ten element został w międzyczasie zmieniony. Odśwież, aby zobaczyć aktualną treść"
      );
    }

    await maybeSnapshot(fastify, documentId, userId, "Edycja treści");

    const block = await fastify.prisma.documentBlock.update({
      where: { id: blockId },
      data: {
        type: input.data.type,
        data: input.data as Prisma.InputJsonValue,
        version: { increment: 1 },
        updatedById: userId
      }
    });
    await fastify.prisma.document.update({ where: { id: documentId }, data: { updatedAt: new Date() } });

    const dto = toBlockDto(block);
    await broadcast(documentId, document.channelId, "block", userId, dto);
    return dto;
  });

  fastify.post("/documents/:documentId/blocks/:blockId/move", async (request) => {
    const { documentId, blockId } = request.params as { documentId: string; blockId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(moveBlockSchema, request.body);
    const { document } = await loadForViewer(documentId, userId);

    await maybeSnapshot(fastify, documentId, userId, "Zmiana kolejności");
    await moveBlock(fastify, documentId, blockId, input.position);
    await fastify.prisma.document.update({ where: { id: documentId }, data: { updatedAt: new Date() } });

    await broadcast(documentId, document.channelId, "structure", userId);
    return loadDocumentDto(fastify, documentId);
  });

  fastify.delete("/documents/:documentId/blocks/:blockId", async (request, reply) => {
    const { documentId, blockId } = request.params as { documentId: string; blockId: string };
    const userId = request.user!.id;
    const { document } = await loadForViewer(documentId, userId);

    const existing = await fastify.prisma.documentBlock.findFirst({ where: { id: blockId, documentId } });
    if (!existing) notFound("Element nie istnieje");
    await assertNotLockedByOther(fastify, documentId, blockId, userId);

    await maybeSnapshot(fastify, documentId, userId, "Usunięcie elementu");
    await fastify.prisma.documentBlock.delete({ where: { id: blockId } });
    await fastify.prisma.document.update({ where: { id: documentId }, data: { updatedAt: new Date() } });

    await broadcast(documentId, document.channelId, "structure", userId);
    return reply.status(204).send();
  });

  /**
   * Ticking a checklist item is intentionally not a normal block edit: it does
   * not need the lock, does not bump the version and does not create a
   * revision. Everyone in the channel can tick items off, which is the whole
   * point of a shared task list, and doing so must never collide with someone
   * rewording the item at the same moment.
   *
   * The whole read-modify-write runs inside a transaction that locks the block
   * row first. Without it, two people ticking DIFFERENT items at the same
   * moment would both read the same list, each write back their own version,
   * and the second write would silently undo the first tick.
   */
  fastify.post("/documents/:documentId/blocks/:blockId/check", async (request, reply) => {
    const { documentId, blockId } = request.params as { documentId: string; blockId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(toggleChecklistItemSchema, request.body);
    const { document } = await loadForViewer(documentId, userId);

    const outcome = await fastify.prisma.$transaction(async (tx) => {
      // Row lock held until the transaction ends; concurrent ticks queue up
      // here instead of racing on a stale copy of the item list. Verified by
      // the regression test: without FOR UPDATE only 2-3 of 12 simultaneous
      // ticks survive, the rest are silently overwritten.
      // Identifiers are TEXT columns (Prisma String ids), so no cast.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM document_blocks WHERE id = ${blockId} AND "documentId" = ${documentId} FOR UPDATE
      `;
      if (locked.length === 0) return { kind: "missing" as const };

      const existing = await tx.documentBlock.findUniqueOrThrow({ where: { id: blockId } });
      const data = parseBlockData(existing.data);
      if (data.type !== "checklist") return { kind: "not-checklist" as const };
      if (!data.items.some((i) => i.id === input.itemId)) return { kind: "no-item" as const };

      const updated = {
        ...data,
        items: data.items.map((i) =>
          i.id === input.itemId
            ? {
                ...i,
                checked: input.checked,
                checkedById: input.checked ? userId : null,
                checkedAt: input.checked ? new Date().toISOString() : null
              }
            : i
        )
      };

      const block = await tx.documentBlock.update({
        where: { id: blockId },
        data: { data: updated as Prisma.InputJsonValue }
      });
      await tx.document.update({ where: { id: documentId }, data: { updatedAt: new Date() } });
      return { kind: "ok" as const, block };
    });

    if (outcome.kind === "missing") notFound("Element nie istnieje");
    if (outcome.kind === "no-item") notFound("Pozycja nie istnieje");
    if (outcome.kind === "not-checklist") {
      return sendError(reply, 400, "NOT_A_CHECKLIST", "Ten element nie jest listą zadań");
    }

    const dto = toBlockDto(outcome.block);
    await broadcast(documentId, document.channelId, "block", userId, dto);
    return dto;
  });

  // ── soft locks ──────────────────────────────────────────────────────────

  fastify.post("/documents/:documentId/blocks/:blockId/lock", async (request, reply) => {
    const { documentId, blockId } = request.params as { documentId: string; blockId: string };
    const userId = request.user!.id;
    const { document } = await loadForViewer(documentId, userId);

    const result = await claimLock(fastify, documentId, blockId, userId);
    await broadcastLocks(documentId, document.channelId);
    if (!result.acquired) {
      return sendError(reply, 409, "BLOCK_LOCKED", "Ktoś inny właśnie edytuje ten element");
    }
    return { blockId, userId };
  });

  fastify.delete("/documents/:documentId/blocks/:blockId/lock", async (request, reply) => {
    const { documentId, blockId } = request.params as { documentId: string; blockId: string };
    const userId = request.user!.id;
    const { document } = await loadForViewer(documentId, userId);

    await releaseLock(fastify, documentId, blockId, userId);
    await broadcastLocks(documentId, document.channelId);
    return reply.status(204).send();
  });

  fastify.get("/documents/:documentId/locks", async (request) => {
    const { documentId } = request.params as { documentId: string };
    await loadForViewer(documentId, request.user!.id);
    const blocks = await fastify.prisma.documentBlock.findMany({
      where: { documentId },
      select: { id: true }
    });
    return listLocks(fastify, documentId, blocks.map((b) => b.id));
  });

  // ── revisions ───────────────────────────────────────────────────────────

  fastify.get("/documents/:documentId/revisions", async (request) => {
    const { documentId } = request.params as { documentId: string };
    await loadForViewer(documentId, request.user!.id);

    const rows = await fastify.prisma.documentRevision.findMany({
      where: { documentId },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    const result: DocumentRevisionDto[] = rows.map((row) => ({
      id: row.id,
      authorId: row.authorId,
      summary: row.summary,
      blockCount: Array.isArray(row.snapshot) ? row.snapshot.length : 0,
      createdAt: row.createdAt.toISOString()
    }));
    return result;
  });

  fastify.get("/documents/:documentId/revisions/:revisionId", async (request) => {
    const { documentId, revisionId } = request.params as { documentId: string; revisionId: string };
    await loadForViewer(documentId, request.user!.id);

    const revision = await fastify.prisma.documentRevision.findFirst({
      where: { id: revisionId, documentId }
    });
    if (!revision) notFound("Wersja nie istnieje");

    const snapshot = Array.isArray(revision.snapshot) ? revision.snapshot : [];
    return {
      id: revision.id,
      authorId: revision.authorId,
      summary: revision.summary,
      createdAt: revision.createdAt.toISOString(),
      blocks: snapshot.map((entry, index) => ({
        id: `preview-${index}`,
        position: index,
        version: 1,
        data: parseBlockData((entry as { data?: unknown }).data),
        updatedById: null,
        updatedAt: revision.createdAt.toISOString()
      }))
    };
  });

  /**
   * Restoring snapshots the current state first, so rolling back is itself
   * reversible and never destroys the version somebody meant to keep.
   */
  fastify.post("/documents/:documentId/revisions/:revisionId/restore", async (request) => {
    const { documentId, revisionId } = request.params as { documentId: string; revisionId: string };
    const userId = request.user!.id;
    const { document } = await loadForViewer(documentId, userId);

    const revision = await fastify.prisma.documentRevision.findFirst({
      where: { id: revisionId, documentId }
    });
    if (!revision) notFound("Wersja nie istnieje");

    const blocks = await fastify.prisma.documentBlock.findMany({
      where: { documentId },
      orderBy: { position: "asc" }
    });
    await fastify.prisma.documentRevision.create({
      data: {
        documentId,
        authorId: userId,
        summary: "Stan przed przywróceniem wersji",
        snapshot: blocks.map((b) => ({
          type: b.type,
          position: b.position,
          data: b.data
        })) as Prisma.InputJsonValue
      }
    });

    const snapshot = Array.isArray(revision.snapshot) ? revision.snapshot : [];
    await fastify.prisma.$transaction(async (tx) => {
      await tx.documentBlock.deleteMany({ where: { documentId } });
      for (const [index, entry] of snapshot.entries()) {
        const data = parseBlockData((entry as { data?: unknown }).data);
        await tx.documentBlock.create({
          data: {
            documentId,
            type: data.type,
            position: (index + 1) * 1000,
            data: data as Prisma.InputJsonValue,
            updatedById: userId
          }
        });
      }
      await tx.document.update({ where: { id: documentId }, data: { updatedAt: new Date() } });
    });

    await broadcast(documentId, document.channelId, "structure", userId);
    return loadDocumentDto(fastify, documentId);
  });

  // ── comments ────────────────────────────────────────────────────────────

  fastify.get("/documents/:documentId/comments", async (request) => {
    const { documentId } = request.params as { documentId: string };
    await loadForViewer(documentId, request.user!.id);

    const rows = await fastify.prisma.documentComment.findMany({
      where: { documentId },
      orderBy: { createdAt: "asc" }
    });
    const result: DocumentCommentDto[] = rows.map((row) => ({
      id: row.id,
      blockId: row.blockId,
      authorId: row.authorId,
      body: row.body,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString()
    }));
    return result;
  });

  fastify.post("/documents/:documentId/comments", async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const userId = request.user!.id;
    const input = parseOrThrow(createCommentSchema, request.body);
    const { document } = await loadForViewer(documentId, userId);

    if (input.blockId) {
      const block = await fastify.prisma.documentBlock.findFirst({
        where: { id: input.blockId, documentId }
      });
      if (!block) notFound("Element nie istnieje");
    }

    const row = await fastify.prisma.documentComment.create({
      data: {
        documentId,
        blockId: input.blockId ?? null,
        authorId: userId,
        body: input.body
      }
    });

    await broadcast(documentId, document.channelId, "comments", userId);
    return reply.status(201).send({
      id: row.id,
      blockId: row.blockId,
      authorId: row.authorId,
      body: row.body,
      resolvedAt: null,
      createdAt: row.createdAt.toISOString()
    } satisfies DocumentCommentDto);
  });

  fastify.post("/documents/:documentId/comments/:commentId/resolve", async (request) => {
    const { documentId, commentId } = request.params as { documentId: string; commentId: string };
    const userId = request.user!.id;
    const { document } = await loadForViewer(documentId, userId);

    const existing = await fastify.prisma.documentComment.findFirst({
      where: { id: commentId, documentId }
    });
    if (!existing) notFound("Komentarz nie istnieje");

    const row = await fastify.prisma.documentComment.update({
      where: { id: commentId },
      data: { resolvedAt: existing.resolvedAt ? null : new Date() }
    });

    await broadcast(documentId, document.channelId, "comments", userId);
    return {
      id: row.id,
      blockId: row.blockId,
      authorId: row.authorId,
      body: row.body,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString()
    } satisfies DocumentCommentDto;
  });

  fastify.delete("/documents/:documentId/comments/:commentId", async (request, reply) => {
    const { documentId, commentId } = request.params as { documentId: string; commentId: string };
    const userId = request.user!.id;
    const { document, membership } = await loadForViewer(documentId, userId);

    const existing = await fastify.prisma.documentComment.findFirst({
      where: { id: commentId, documentId }
    });
    if (!existing) notFound("Komentarz nie istnieje");
    if (existing.authorId !== userId && membership.role !== "ADMIN") {
      forbidden("Komentarz może usunąć jego autor lub administrator kanału");
    }

    await fastify.prisma.documentComment.delete({ where: { id: commentId } });
    await broadcast(documentId, document.channelId, "comments", userId);
    return reply.status(204).send();
  });

  // ── CSV export ──────────────────────────────────────────────────────────

  fastify.get("/documents/:documentId/blocks/:blockId/csv", async (request, reply) => {
    const { documentId, blockId } = request.params as { documentId: string; blockId: string };
    await loadForViewer(documentId, request.user!.id);

    const block = await fastify.prisma.documentBlock.findFirst({ where: { id: blockId, documentId } });
    if (!block) notFound("Element nie istnieje");

    const data = parseBlockData(block.data);
    if (data.type !== "table") {
      return sendError(reply, 400, "NOT_A_TABLE", "Ten element nie jest tabelą");
    }

    // BOM so Excel opens UTF-8 Polish characters correctly instead of mojibake.
    const csv = `\uFEFF${toCsv([data.header, ...data.rows])}`;
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="tabela-${blockId.slice(0, 8)}.csv"`)
      .send(csv);
  });
}
