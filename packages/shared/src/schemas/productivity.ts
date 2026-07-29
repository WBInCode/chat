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

/** Hard ceiling on answers, mirrored by the creation UI. */
export const POLL_MAX_OPTIONS = 10;

/**
 * How many voters are inlined per option in the poll payload. The card only
 * needs a small avatar stack; the full list is fetched on demand from
 * `GET /polls/:pollId/voters` so that a 300-person channel does not ship
 * 300 user records with every poll rendered in the history.
 */
export const POLL_VOTER_PREVIEW = 3;

export const pollOptionInputSchema = z.object({
  text: z.string().trim().min(1).max(120),
  // A single grapheme in practice, but emoji with skin-tone or ZWJ sequences
  // are several code points long, hence the generous ceiling.
  emoji: z.string().trim().max(24).nullable().optional()
});

export const createPollSchema = z.object({
  channelId: z.string().uuid(),
  question: z.string().trim().min(1).max(300),
  options: z.array(pollOptionInputSchema).min(2).max(POLL_MAX_OPTIONS),
  allowMultiple: z.boolean().default(false),
  /**
   * Hides who voted for what, from everyone including the author. Irreversible
   * once the poll exists. This is confidentiality at the API level, not a
   * cryptographically secret ballot: vote rows still reference the voter,
   * because that is what enforces one vote per person and enables un-voting.
   */
  hideVoters: z.boolean().default(false),
  closesAt: z.string().datetime().nullable().optional()
});
export type CreatePollInput = z.infer<typeof createPollSchema>;

export const votePollSchema = z.object({
  optionId: z.string().uuid()
});
export type VotePollInput = z.infer<typeof votePollSchema>;

export interface PollVoterDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PollOptionDto {
  id: string;
  text: string;
  emoji: string | null;
  votes: number;
  votedByMe: boolean;
  /** Always empty when the poll hides voters. Capped at `POLL_VOTER_PREVIEW`. */
  voterPreview: PollVoterDto[];
}

export interface PollDto {
  id: string;
  messageId: string;
  authorId: string;
  question: string;
  allowMultiple: boolean;
  hideVoters: boolean;
  closesAt: string | null;
  closedAt: string | null;
  /** Resolved server-side from `closedAt` and `closesAt` — clients must not recompute. */
  closed: boolean;
  /** Ballots cast in total; with multi-choice this exceeds `voterCount`. */
  totalVotes: number;
  /** Distinct people who voted. Basis for the percentages shown in the UI. */
  voterCount: number;
  /** Whether the viewer may close the poll early (author, channel or org admin). */
  canClose: boolean;
  options: PollOptionDto[];
}

export interface PollVotersDto {
  pollId: string;
  options: Array<{ optionId: string; voters: PollVoterDto[] }>;
}
