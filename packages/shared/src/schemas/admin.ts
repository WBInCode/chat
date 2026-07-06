import { z } from "zod";

export const adminOrgRoleSchema = z.enum(["OWNER", "ADMIN", "HR", "MEMBER"]);
export type AdminOrgRole = z.infer<typeof adminOrgRoleSchema>;

export const changeRoleSchema = z.object({
  role: z.enum(["ADMIN", "HR", "MEMBER"]) // OWNER assigned only via transfer
});
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const setDeactivatedSchema = z.object({
  disabled: z.boolean()
});
export type SetDeactivatedInput = z.infer<typeof setDeactivatedSchema>;

export const orgSettingsSchema = z.object({
  require2fa: z.boolean().optional(),
  messageRetentionDays: z.number().int().positive().max(3650).nullable().optional(),
  allowedEmailDomains: z.string().trim().max(500).nullable().optional()
});
export type OrgSettingsInput = z.infer<typeof orgSettingsSchema>;

export const auditLogQuerySchema = z.object({
  actorId: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export interface AdminMemberDto {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: AdminOrgRole;
  disabled: boolean;
  totpEnabled: boolean;
  createdAt: string;
}

export interface AdminChannelDto {
  id: string;
  name: string | null;
  type: "PUBLIC" | "PRIVATE" | "DM";
  memberCount: number;
  archived: boolean;
  createdAt: string;
}

export interface AuditLogEntryDto {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  meta: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

export interface AdminDashboardDto {
  totalMembers: number;
  activeMembers7d: number;
  messagesLast30d: number[]; // one entry per day, oldest first
  totalFiles: number;
  recentSecurityEvents: AuditLogEntryDto[];
}
