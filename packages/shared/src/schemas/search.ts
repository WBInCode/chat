import { z } from "zod";

export const searchQuerySchema = z
  .object({
    q: z.string().trim().max(200).default(""),
    orgId: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    fromUserId: z.string().uuid().optional(),
    channelId: z.string().uuid().optional(),
    hasFile: z.coerce.boolean().optional(),
    before: z.string().datetime().optional(),
    after: z.string().datetime().optional()
  })
  .refine((v) => v.q.length >= 2 || v.fromUserId || v.channelId || v.hasFile || v.before || v.after, {
    message: "Podaj co najmniej 2 znaki tekstu lub jeden filtr",
    path: ["q"]
  });
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export interface SearchResultDto {
  messageId: string;
  channelId: string;
  channelName: string | null;
  authorId: string;
  content: string;
  createdAt: string;
}
