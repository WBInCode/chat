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

// Curated palette — avoids arbitrary unicode abuse while covering the
// standard set of workplace reactions.
export const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "👀", "✅", "🚀", "🔥"] as const;

export const toggleReactionSchema = z.object({
  messageId: z.string().uuid(),
  emoji: z.enum(ALLOWED_REACTIONS)
});
export type ToggleReactionInput = z.infer<typeof toggleReactionSchema>;
