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
  customRoleId: string | null;
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

// ── Custom roles (F5-C) ──────────────────────────────────────────────────
export const ORG_PERMISSIONS = [
  "member.invite",
  "member.remove",
  "member.changeRole",
  "member.deactivate",
  "channel.manage",
  "channel.create",
  "org.settings",
  "org.auditLog",
  "org.auditLogFull",
  "org.export",
  "org.transferOwnership",
  "role.manage",
  "ai.use",
  "voice.use"
] as const;
export type OrgPermission = (typeof ORG_PERMISSIONS)[number];

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(50),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Kolor w formacie #rrggbb")
    .default("#8b5cf6"),
  permissions: z.array(z.enum(ORG_PERMISSIONS)).max(ORG_PERMISSIONS.length)
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(50).optional(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Kolor w formacie #rrggbb")
    .optional(),
  permissions: z.array(z.enum(ORG_PERMISSIONS)).max(ORG_PERMISSIONS.length).optional()
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const setCustomRoleSchema = z.object({
  roleId: z.string().uuid().nullable()
});
export type SetCustomRoleInput = z.infer<typeof setCustomRoleSchema>;

export interface RoleDto {
  id: string;
  name: string;
  color: string;
  permissions: OrgPermission[];
  memberCount: number;
  createdAt: string;
}
