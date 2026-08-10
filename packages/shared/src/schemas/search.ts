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

/**
 * Wyszukiwanie dokumentów jest osobne od wiadomości: wynik wskazuje dokument,
 * nie pojedynczą wiadomość, więc nie da się go wcisnąć w `SearchResultDto`
 * bez pól, które dla wiadomości nic nie znaczą.
 */
export const documentSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  orgId: z.string().uuid(),
  channelId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});
export type DocumentSearchQuery = z.infer<typeof documentSearchQuerySchema>;

export interface DocumentSearchResultDto {
  documentId: string;
  channelId: string;
  channelName: string | null;
  title: string;
  icon: string | null;
  /** Fragment, w którym trafiono — tytuł albo treść elementu. */
  snippet: string;
  updatedAt: string;
}
