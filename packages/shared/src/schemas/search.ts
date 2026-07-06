import { z } from "zod";

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  orgId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
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
