import { z } from "zod";

export const scheduleMessageSchema = z.object({
  content: z.string().trim().min(1).max(8000),
  sendAt: z.string().datetime()
});
export type ScheduleMessageInput = z.infer<typeof scheduleMessageSchema>;

export interface ScheduledMessageDto {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  sendAt: string;
  sentAt: string | null;
  createdAt: string;
}

export const createReminderSchema = z.object({
  messageId: z.string().uuid(),
  remindAt: z.string().datetime(),
  note: z.string().trim().max(200).nullable().optional()
});
export type CreateReminderInput = z.infer<typeof createReminderSchema>;

export interface ReminderDto {
  id: string;
  messageId: string;
  channelId: string;
  note: string | null;
  remindAt: string;
  sentAt: string | null;
  createdAt: string;
}

export const createPollSchema = z.object({
  channelId: z.string().uuid(),
  question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(10),
  allowMultiple: z.boolean().default(false),
  closesAt: z.string().datetime().nullable().optional()
});
export type CreatePollInput = z.infer<typeof createPollSchema>;

export interface PollOptionDto {
  id: string;
  text: string;
  votes: number;
  votedByMe: boolean;
}

export interface PollDto {
  id: string;
  messageId: string;
  question: string;
  allowMultiple: boolean;
  closesAt: string | null;
  totalVotes: number;
  options: PollOptionDto[];
}
