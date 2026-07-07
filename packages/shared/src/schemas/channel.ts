import { z } from "zod";

export const channelTypeSchema = z.enum(["PUBLIC", "PRIVATE", "DM"]);
export type ChannelType = z.infer<typeof channelTypeSchema>;

export const channelRoleSchema = z.enum(["ADMIN", "MEMBER"]);
export type ChannelRole = z.infer<typeof channelRoleSchema>;

export const createChannelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "Tylko małe litery, cyfry i myślniki"),
  type: z.enum(["PUBLIC", "PRIVATE"])
});
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const createDmSchema = z.object({
  targetUserId: z.string().uuid()
});
export type CreateDmInput = z.infer<typeof createDmSchema>;

export const createGroupDmSchema = z.object({
  memberUserIds: z.array(z.string().uuid()).min(2).max(20)
});
export type CreateGroupDmInput = z.infer<typeof createGroupDmSchema>;

export const addChannelMemberSchema = z.object({
  userId: z.string().uuid()
});
export type AddChannelMemberInput = z.infer<typeof addChannelMemberSchema>;

export const setChannelTopicSchema = z.object({
  topic: z.string().trim().max(250).nullable()
});
export type SetChannelTopicInput = z.infer<typeof setChannelTopicSchema>;

export const renameChannelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "Tylko małe litery, cyfry i myślniki")
});
export type RenameChannelInput = z.infer<typeof renameChannelSchema>;

export interface BrowseChannelDto {
  id: string;
  name: string | null;
  type: "PUBLIC" | "PRIVATE";
  topic: string | null;
  memberCount: number;
  isMember: boolean;
  archivedAt: string | null;
}

export const setMutedSchema = z.object({
  muted: z.boolean()
});
export type SetMutedInput = z.infer<typeof setMutedSchema>;

export const setFavoriteSchema = z.object({
  favorite: z.boolean()
});
export type SetFavoriteInput = z.infer<typeof setFavoriteSchema>;
