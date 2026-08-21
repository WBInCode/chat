import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import {
  documentBlockDataSchema,
  DOCUMENT_LOCK_TTL_SECONDS,
  type DocumentBlockData,
  type DocumentBlockDto,
  type DocumentDto,
  type DocumentLockDto,
  type DocumentSummaryDto
} from "@chatv2/shared";
import { HttpError } from "../../lib/authz.js";

/** A new snapshot is written when the last one is older than this. */
const REVISION_MAX_AGE_MS = 5 * 60 * 1000;

/** Positions are renumbered in steps so a later insert rarely rewrites siblings. */
const POSITION_STEP = 1000;

type BlockRow = {
  id: string;
  position: number;
  version: number;
  data: Prisma.JsonValue;
  updatedById: string | null;
  updatedAt: Date;
};

/**
 * Blocks are stored as JSON, so anything already in the database is parsed
 * defensively on read. A row that somehow fails validation degrades to an
 * empty paragraph rather than crashing the whole document.
 */
export function parseBlockData(raw: unknown): DocumentBlockData {
  const parsed = documentBlockDataSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return { type: "text", text: "" };
}

export function toBlockDto(row: BlockRow): DocumentBlockDto {
  return {
    id: row.id,
    position: row.position,
    version: row.version,
    data: parseBlockData(row.data),
    updatedById: row.updatedById,
    updatedAt: row.updatedAt.toISOString()
  };
}

export interface CzlonekDoPowiadomienia {
  userId: string;
  mutedAt: Date | null;
  user: { displayName: string; notifyMode: string };
}

/**
 * Zamienia znaki o znaczeniu w HTML na encje. Treść dokumentu pisza ludzie,
 * a Chromium po stronie Gotenberga wykonuje skrypty — bez tego wstawiony
 * `<script>` uruchomiłby się przy generowaniu PDF.
 */
export function escapujHtml(tekst: string): string {
  return tekst
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Składa dokument w samodzielny HTML do wydruku. Bez zasobów zewnętrznych. */
export function renderujDokumentHtml(input: {
  title: string;
  icon: string | null;
  bloki: DocumentBlockDto[];
}): string {
  const czesci = input.bloki.map((blok) => {
    const dane = blok.data;
    switch (dane.type) {
      case "heading":
        return `<h${dane.level}>${escapujHtml(dane.text)}</h${dane.level}>`;
      case "text":
        return `<p>${escapujHtml(dane.text).replace(/\n/g, "<br>")}</p>`;
      case "divider":
        return "<hr>";
      case "checklist":
        return `<ul class="zadania">${dane.items
          .map(
            (poz) =>
              `<li><span class="znacznik">${poz.checked ? "☑" : "☐"}</span>` +
              `<span class="${poz.checked ? "zrobione" : ""}">${escapujHtml(poz.text)}</span></li>`
          )
          .join("")}</ul>`;
      case "table":
        return (
          `<table><thead><tr>${dane.header
            .map((n, i) => `<th style="text-align:${dane.align[i] ?? "left"}">${escapujHtml(n)}</th>`)
            .join("")}</tr></thead><tbody>${dane.rows
            .map(
              (wiersz) =>
                `<tr>${wiersz
                  .map((k, i) => `<td style="text-align:${dane.align[i] ?? "left"}">${escapujHtml(k)}</td>`)
                  .join("")}</tr>`
            )
            .join("")}</tbody></table>`
        );
    }
  });

  const naglowek = `${input.icon ? `${escapujHtml(input.icon)} ` : ""}${escapujHtml(input.title)}`;
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${escapujHtml(input.title)}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;font-size:12pt;line-height:1.5;color:#1a1a1a}
h1.tytul{font-size:20pt;margin:0 0 18px;border-bottom:2px solid #ddd;padding-bottom:8px}
h1{font-size:17pt}h2{font-size:14pt}h3{font-size:12.5pt}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:10.5pt}
th,td{border:1px solid #ccc;padding:5px 8px;vertical-align:top}
th{background:#f3f4f6}
ul.zadania{list-style:none;padding-left:0}
ul.zadania li{margin:3px 0}
.znacznik{margin-right:7px}
.zrobione{text-decoration:line-through;color:#777}
hr{border:0;border-top:1px solid #ddd;margin:14px 0}
</style></head><body><h1 class="tytul">${naglowek}</h1>${czesci.join("")}</body></html>`;
}

/**
 * Kto ma dostać powiadomienie o nowym komentarzu.
 *
 * Celowo NIE cały kanał: komentarze potrafią się sypać seriami przy jednym
 * przeglądzie dokumentu i powiadamianie wszystkich zamieniłoby je w szum,
 * który ludzie wyciszają razem z całym kanałem. Zawiadamiamy tych, kogo
 * komentarz faktycznie dotyczy — wskazanych przez `@`, autora dokumentu
 * i autora omawianego elementu.
 */
export function odbiorcyKomentarza(input: {
  czlonkowie: CzlonekDoPowiadomienia[];
  autorKomentarzaId: string;
  autorDokumentuId: string;
  autorBlokuId: string | null;
  tresc: string;
}): string[] {
  const wskazani = new Set<string>([input.autorDokumentuId]);
  if (input.autorBlokuId) wskazani.add(input.autorBlokuId);
  for (const czlonek of input.czlonkowie) {
    if (input.tresc.includes(`@${czlonek.user.displayName}`)) wskazani.add(czlonek.userId);
  }

  return input.czlonkowie
    .filter((czlonek) => czlonek.userId !== input.autorKomentarzaId)
    .filter((czlonek) => wskazani.has(czlonek.userId))
    .filter((czlonek) => !czlonek.mutedAt && czlonek.user.notifyMode !== "NONE")
    .map((czlonek) => czlonek.userId);
}

export function toSummaryDto(row: {
  id: string;
  channelId: string;
  title: string;
  icon: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  _count?: { blocks: number };
  openCommentCount?: number;
}): DocumentSummaryDto {
  return {
    id: row.id,
    channelId: row.channelId,
    title: row.title,
    icon: row.icon,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    blockCount: row._count?.blocks ?? 0,
    openCommentCount: row.openCommentCount ?? 0
  };
}

export async function loadDocumentDto(
  fastify: FastifyInstance,
  documentId: string
): Promise<DocumentDto> {
  const doc = await fastify.prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { blocks: { orderBy: { position: "asc" } } }
  });
  const openCommentCount = await fastify.prisma.documentComment.count({
    where: { documentId, resolvedAt: null }
  });
  return {
    ...toSummaryDto({ ...doc, _count: { blocks: doc.blocks.length }, openCommentCount }),
    blocks: doc.blocks.map(toBlockDto)
  };
}

// ── soft locks ─────────────────────────────────────────────────────────────

function lockKey(documentId: string, blockId: string) {
  return `doc-lock:${documentId}:${blockId}`;
}

/**
 * Claims a block for editing. Returns the current holder either way, so the
 * caller can tell "I got it" from "someone else has it". The lock is advisory
 * and short-lived: it stops two people typing into the same table at once,
 * and it expires on its own if a browser tab disappears without releasing.
 */
export async function claimLock(
  fastify: FastifyInstance,
  documentId: string,
  blockId: string,
  userId: string
): Promise<{ acquired: boolean; holderId: string }> {
  const key = lockKey(documentId, blockId);
  const existing = await fastify.redis.get(key);
  if (existing && existing !== userId) return { acquired: false, holderId: existing };
  await fastify.redis.set(key, userId, "EX", DOCUMENT_LOCK_TTL_SECONDS);
  return { acquired: true, holderId: userId };
}

export async function releaseLock(
  fastify: FastifyInstance,
  documentId: string,
  blockId: string,
  userId: string
): Promise<void> {
  const key = lockKey(documentId, blockId);
  const existing = await fastify.redis.get(key);
  // Only the holder may release, otherwise a stale tab could free someone
  // else's freshly acquired lock.
  if (existing === userId) await fastify.redis.del(key);
}

export async function listLocks(
  fastify: FastifyInstance,
  documentId: string,
  blockIds: string[]
): Promise<DocumentLockDto[]> {
  if (blockIds.length === 0) return [];
  const values = await fastify.redis.mget(blockIds.map((id) => lockKey(documentId, id)));
  const locks: DocumentLockDto[] = [];
  values.forEach((userId, index) => {
    if (userId) locks.push({ blockId: blockIds[index]!, userId });
  });
  return locks;
}

export async function assertNotLockedByOther(
  fastify: FastifyInstance,
  documentId: string,
  blockId: string,
  userId: string
): Promise<void> {
  const holder = await fastify.redis.get(lockKey(documentId, blockId));
  if (holder && holder !== userId) {
    throw new HttpError(409, "BLOCK_LOCKED", "Ktoś inny właśnie edytuje ten element");
  }
}

// ── revisions ──────────────────────────────────────────────────────────────

/**
 * Writes a snapshot before a change, but only when it adds information:
 * either enough time has passed since the previous one, or a different person
 * is now editing. Without this, every keystroke-sized save would bury the
 * history in near-identical entries.
 */
export async function maybeSnapshot(
  fastify: FastifyInstance,
  documentId: string,
  authorId: string,
  summary: string
): Promise<void> {
  const last = await fastify.prisma.documentRevision.findFirst({
    where: { documentId },
    orderBy: { createdAt: "desc" }
  });

  const stale = !last || Date.now() - last.createdAt.getTime() > REVISION_MAX_AGE_MS;
  const differentAuthor = last?.authorId !== authorId;
  if (last && !stale && !differentAuthor) return;

  const blocks = await fastify.prisma.documentBlock.findMany({
    where: { documentId },
    orderBy: { position: "asc" }
  });
  // Nothing to preserve yet; an empty first snapshot would only add noise.
  if (blocks.length === 0 && !last) return;

  await fastify.prisma.documentRevision.create({
    data: {
      documentId,
      authorId,
      summary,
      snapshot: blocks.map((b) => ({
        type: b.type,
        position: b.position,
        data: b.data
      })) as Prisma.InputJsonValue
    }
  });
}

// ── positions ──────────────────────────────────────────────────────────────

/**
 * Resolves the sort key for a block inserted after `afterBlockId`. When there
 * is no gap left between two neighbours the whole document is renumbered,
 * which is rare and cheap at document scale.
 */
export async function positionAfter(
  fastify: FastifyInstance,
  documentId: string,
  afterBlockId: string | null
): Promise<number> {
  const blocks = await fastify.prisma.documentBlock.findMany({
    where: { documentId },
    orderBy: { position: "asc" },
    select: { id: true, position: true }
  });

  if (blocks.length === 0) return POSITION_STEP;
  if (!afterBlockId) return blocks[blocks.length - 1]!.position + POSITION_STEP;

  const index = blocks.findIndex((b) => b.id === afterBlockId);
  if (index === -1) return blocks[blocks.length - 1]!.position + POSITION_STEP;
  if (index === blocks.length - 1) return blocks[index]!.position + POSITION_STEP;

  const before = blocks[index]!.position;
  const after = blocks[index + 1]!.position;
  if (after - before > 1) return Math.floor((before + after) / 2);

  await renumber(fastify, documentId);
  return positionAfter(fastify, documentId, afterBlockId);
}

export async function renumber(fastify: FastifyInstance, documentId: string): Promise<void> {
  const blocks = await fastify.prisma.documentBlock.findMany({
    where: { documentId },
    orderBy: { position: "asc" },
    select: { id: true }
  });
  await fastify.prisma.$transaction(
    blocks.map((b, i) =>
      fastify.prisma.documentBlock.update({
        where: { id: b.id },
        data: { position: (i + 1) * POSITION_STEP }
      })
    )
  );
}

/** Moves a block to a zero-based index, renumbering the document afterwards. */
export async function moveBlock(
  fastify: FastifyInstance,
  documentId: string,
  blockId: string,
  targetIndex: number
): Promise<void> {
  const blocks = await fastify.prisma.documentBlock.findMany({
    where: { documentId },
    orderBy: { position: "asc" },
    select: { id: true }
  });
  const current = blocks.findIndex((b) => b.id === blockId);
  if (current === -1) throw new HttpError(404, "NOT_FOUND", "Element nie istnieje");

  const ordered = blocks.map((b) => b.id);
  ordered.splice(current, 1);
  ordered.splice(Math.min(targetIndex, ordered.length), 0, blockId);

  await fastify.prisma.$transaction(
    ordered.map((id, i) =>
      fastify.prisma.documentBlock.update({
        where: { id },
        data: { position: (i + 1) * POSITION_STEP }
      })
    )
  );
}

// ── CSV export ─────────────────────────────────────────────────────────────

/**
 * RFC 4180 quoting. Also neutralises the leading characters that spreadsheet
 * software executes as a formula, so a cell typed as `=cmd|...` opens as text
 * instead of running when the export is opened in Excel (CSV injection).
 */
export function toCsv(rows: string[][]): string {
  const escapeCell = (cell: string) => {
    const dangerous = /^[=+\-@\t\r]/.test(cell);
    const value = dangerous ? `'${cell}` : cell;
    return `"${value.replace(/"/g, '""')}"`;
  };
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
}
