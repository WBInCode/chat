import { z } from "zod";

// Platform-level super-admin (F5-H) — cross-org user/org management,
// completely separate from the per-org admin panel and its OrgRole matrix.

export const createPlatformOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Tylko małe litery, cyfry i myślniki")
});
export type CreatePlatformOrgInput = z.infer<typeof createPlatformOrgSchema>;

export const assignMembershipSchema = z.object({
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
  role: z.enum(["OWNER", "ADMIN", "HR", "MEMBER"])
});
export type AssignMembershipInput = z.infer<typeof assignMembershipSchema>;

export interface PlatformUserMembershipDto {
  orgId: string;
  orgName: string;
  role: "OWNER" | "ADMIN" | "HR" | "MEMBER";
  disabled: boolean;
}

export interface PlatformUserDto {
  id: string;
  email: string;
  displayName: string;
  isSuperAdmin: boolean;
  deletedAt: string | null;
  createdAt: string;
  memberships: PlatformUserMembershipDto[];
}

export interface PlatformOrgDto {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  channelCount: number;
  createdAt: string;
}
