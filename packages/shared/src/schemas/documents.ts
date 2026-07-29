import { z } from "zod";

/**
 * Shared documents module (F8): a document lives in a channel and is built
 * from ordered blocks. Every block type carries its own payload shape, so the
 * schema below is a discriminated union rather than a free-form JSON blob —
 * the API validates the exact shape before anything is persisted.
 *
 * Concurrency model, stated plainly: this is NOT a CRDT. Two people can work
 * on the same document at the same time, but only one person edits a given
 * block at a time, guarded by a short-lived soft lock plus an optimistic
 * version check on save. Simultaneous edits of the SAME block are refused
 * with a conflict, never silently merged or overwritten.
 */

export const DOCUMENT_BLOCK_TYPES = ["heading", "text", "table", "checklist", "divider"] as const;
export type DocumentBlockType = (typeof DOCUMENT_BLOCK_TYPES)[number];

/** Seconds a soft lock survives without a refresh; the client renews at half this. */
export const DOCUMENT_LOCK_TTL_SECONDS = 30;

export const TABLE_MAX_COLUMNS = 12;
export const TABLE_MAX_ROWS = 200;
export const CHECKLIST_MAX_ITEMS = 100;

export const cellAlignSchema = z.enum(["left", "center", "right"]);
export type CellAlign = z.infer<typeof cellAlignSchema>;

const headingBlockSchema = z.object({
  type: z.literal("heading"),
  text: z.string().trim().max(200),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)])
});

const textBlockSchema = z.object({
  type: z.literal("text"),
  /** Inline markdown (bold, italic, code, links) rendered by the chat renderer. */
  text: z.string().max(10_000)
});

const tableBlockSchema = z
  .object({
    type: z.literal("table"),
    header: z.array(z.string().max(200)).min(1).max(TABLE_MAX_COLUMNS),
    align: z.array(cellAlignSchema).min(1).max(TABLE_MAX_COLUMNS),
    rows: z.array(z.array(z.string().max(2000))).max(TABLE_MAX_ROWS)
  })
  .superRefine((value, ctx) => {
    const width = value.header.length;
    if (value.align.length !== width) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Liczba wyrównań musi odpowiadać liczbie kolumn"
      });
    }
    // A ragged table would render with holes and break CSV export, so the
    // rectangle is enforced at the boundary instead of patched on read.
    const ragged = value.rows.findIndex((row) => row.length !== width);
    if (ragged !== -1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Wiersz ${ragged + 1} ma inną liczbę komórek niż nagłówek`
      });
    }
  });

const checklistItemSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().max(500),
  checked: z.boolean(),
  checkedById: z.string().nullable(),
  checkedAt: z.string().nullable()
});

const checklistBlockSchema = z.object({
  type: z.literal("checklist"),
  items: z.array(checklistItemSchema).max(CHECKLIST_MAX_ITEMS)
});

const dividerBlockSchema = z.object({ type: z.literal("divider") });

export const documentBlockDataSchema = z.union([
  headingBlockSchema,
  textBlockSchema,
  tableBlockSchema,
  checklistBlockSchema,
  dividerBlockSchema
]);

export type DocumentBlockData = z.infer<typeof documentBlockDataSchema>;
export type TableBlockData = z.infer<typeof tableBlockSchema>;
export type ChecklistBlockData = z.infer<typeof checklistBlockSchema>;
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

// ── request payloads ───────────────────────────────────────────────────────

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  icon: z.string().trim().max(24).nullable().optional()
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  icon: z.string().trim().max(24).nullable().optional()
});

export const createBlockSchema = z.object({
  /** Insert after this block; omit to append at the end. */
  afterBlockId: z.string().uuid().nullable().optional(),
  data: documentBlockDataSchema
});

export const updateBlockSchema = z.object({
  /** Version the client last saw. A mismatch means someone else saved first. */
  version: z.number().int().min(1),
  data: documentBlockDataSchema
});

export const moveBlockSchema = z.object({
  /** Target index in the block list, zero-based. */
  position: z.number().int().min(0)
});

export const toggleChecklistItemSchema = z.object({
  itemId: z.string().min(1).max(64),
  checked: z.boolean()
});

export const createCommentSchema = z.object({
  blockId: z.string().uuid().nullable().optional(),
  body: z.string().trim().min(1).max(2000)
});

// ── responses ──────────────────────────────────────────────────────────────

export interface DocumentBlockDto {
  id: string;
  position: number;
  version: number;
  data: DocumentBlockData;
  updatedById: string | null;
  updatedAt: string;
}

export interface DocumentSummaryDto {
  id: string;
  channelId: string;
  title: string;
  icon: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  blockCount: number;
  openCommentCount: number;
}

export interface DocumentDto extends DocumentSummaryDto {
  blocks: DocumentBlockDto[];
}

export interface DocumentRevisionDto {
  id: string;
  authorId: string | null;
  summary: string;
  blockCount: number;
  createdAt: string;
}

export interface DocumentCommentDto {
  id: string;
  blockId: string | null;
  authorId: string;
  body: string;
  resolvedAt: string | null;
  createdAt: string;
}

/** Who is currently holding a block open for editing. */
export interface DocumentLockDto {
  blockId: string;
  userId: string;
}

/** Empty starting payload for each block type, shared by the API and the UI. */
export function emptyBlockData(type: DocumentBlockType): DocumentBlockData {
  switch (type) {
    case "heading":
      return { type: "heading", text: "", level: 2 };
    case "text":
      return { type: "text", text: "" };
    case "table":
      return {
        type: "table",
        header: ["Kolumna 1", "Kolumna 2"],
        align: ["left", "left"],
        rows: [
          ["", ""],
          ["", ""]
        ]
      };
    case "checklist":
      return { type: "checklist", items: [] };
    case "divider":
      return { type: "divider" };
  }
}
