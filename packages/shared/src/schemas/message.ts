import { z } from "zod";

// Max message length enforced both client & server side (DoS / abuse guard).
export const MAX_MESSAGE_LENGTH = 8000;

export const sendMessageSchema = z
  .object({
    channelId: z.string().uuid(),
    // Caption is optional when the message carries at least one file.
    content: z.string().trim().max(MAX_MESSAGE_LENGTH).default(""),
    fileIds: z.array(z.string().uuid()).max(10).default([]),
    // Thread reply: parent message id (must belong to the same channel).
    parentId: z.string().uuid().optional(),
    tempId: z.string().min(1).max(100).optional()
  })
  .refine((v) => v.content.length > 0 || v.fileIds.length > 0, {
    message: "Wiadomość musi zawierać treść lub co najmniej jeden plik"
  });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({
  content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH)
});
export type EditMessageInput = z.infer<typeof editMessageSchema>;

export const listMessagesQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

export const markReadSchema = z.object({
  channelId: z.string().uuid(),
  messageId: z.string().uuid()
});
export type MarkReadInput = z.infer<typeof markReadSchema>;

// Curated palette shown in the quick-reaction bar. The full picker allows
// any single emoji, but this stays the fast default set.
export const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "👀", "✅", "🚀", "🔥"] as const;

// Validates that a string is exactly ONE emoji grapheme (base pictographic
// with optional variation selectors / ZWJ sequences / skin-tone modifiers,
// a two-char regional-indicator flag, or a keycap sequence). This keeps the
// original "no arbitrary unicode abuse" guarantee while allowing the full
// emoji palette instead of a fixed list.
const SINGLE_EMOJI =
  /^(?:\p{Regional_Indicator}\p{Regional_Indicator}|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|\u20E3)*|[0-9#*]\uFE0F?\u20E3)$/u;

export const reactionEmojiSchema = z
  .string()
  .min(1)
  .max(24)
  .refine((s) => SINGLE_EMOJI.test(s), "must be a single emoji");

export const toggleReactionSchema = z.object({
  messageId: z.string().uuid(),
  emoji: reactionEmojiSchema
});
export type ToggleReactionInput = z.infer<typeof toggleReactionSchema>;
