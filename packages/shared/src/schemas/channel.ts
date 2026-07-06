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

export const addChannelMemberSchema = z.object({
  userId: z.string().uuid()
});
export type AddChannelMemberInput = z.infer<typeof addChannelMemberSchema>;
