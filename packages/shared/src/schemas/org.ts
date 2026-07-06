import { z } from "zod";

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(50)
  .regex(/^[a-z0-9-]+$/, "Tylko małe litery, cyfry i myślniki");

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slugSchema
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export const orgRoleSchema = z.enum(["OWNER", "ADMIN", "HR", "MEMBER"]);
export type OrgRole = z.infer<typeof orgRoleSchema>;

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: orgRoleSchema.default("MEMBER")
});
export type InviteInput = z.infer<typeof inviteSchema>;
