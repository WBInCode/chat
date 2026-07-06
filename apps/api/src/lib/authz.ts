import type { FastifyInstance } from "fastify";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export function notFound(message = "Zasób nie istnieje"): never {
  throw new HttpError(404, "NOT_FOUND", message);
}

export function forbidden(message = "Brak uprawnień"): never {
  throw new HttpError(403, "FORBIDDEN", message);
}

/**
 * Central authorization helpers — every resource access verifies the
 * membership chain (user ∈ org, user ∈ channel) server-side, deny-by-default.
 * 404 is intentionally returned instead of 403 for resources the user
 * cannot see at all, to avoid leaking their existence (IDOR probing).
 */
export async function assertOrgMember(fastify: FastifyInstance, userId: string, orgId: string) {
  const membership = await fastify.prisma.membership.findUnique({
    where: { userId_orgId: { userId, orgId } }
  });
  if (!membership || membership.disabledAt) notFound("Organizacja nie istnieje");
  return membership;
}

export async function assertOrgAdmin(fastify: FastifyInstance, userId: string, orgId: string) {
  const membership = await assertOrgMember(fastify, userId, orgId);
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    forbidden("Wymagane uprawnienia administratora organizacji");
  }
  return membership;
}

export type OrgRole = "OWNER" | "ADMIN" | "HR" | "MEMBER";
export type OrgAction =
  | "member.invite"
  | "member.remove"
  | "member.changeRole"
  | "member.deactivate"
  | "channel.manage"
  | "org.settings"
  | "org.auditLog"
  | "org.auditLogFull" // includes actions performed BY admins/owner
  | "org.export"
  | "org.transferOwnership";

/**
 * Single source of truth for the role × action permission matrix (see
 * PLAN-FAZA2.md §E1). Kept as plain data so the rules are easy to audit
 * and unit-test, rather than scattered `if (role === ...)` checks.
 */
const PERMISSION_MATRIX: Record<OrgAction, OrgRole[]> = {
  "member.invite": ["OWNER", "ADMIN", "HR"],
  "member.remove": ["OWNER", "ADMIN", "HR"],
  "member.changeRole": ["OWNER", "ADMIN"],
  "member.deactivate": ["OWNER", "ADMIN", "HR"],
  "channel.manage": ["OWNER", "ADMIN"],
  "org.settings": ["OWNER", "ADMIN"],
  "org.auditLog": ["OWNER", "ADMIN", "HR"],
  "org.auditLogFull": ["OWNER", "ADMIN"],
  "org.export": ["OWNER"],
  "org.transferOwnership": ["OWNER"]
};

export function can(role: OrgRole, action: OrgAction): boolean {
  return PERMISSION_MATRIX[action].includes(role);
}

export async function assertOrgPermission(
  fastify: FastifyInstance,
  userId: string,
  orgId: string,
  action: OrgAction
) {
  const membership = await assertOrgMember(fastify, userId, orgId);
  if (!can(membership.role as OrgRole, action)) {
    forbidden("Brak uprawnień do wykonania tej akcji");
  }
  return membership;
}

export async function assertChannelMember(
  fastify: FastifyInstance,
  userId: string,
  channelId: string
) {
  const member = await fastify.prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
    include: { channel: true }
  });
  if (!member) notFound("Kanał nie istnieje");
  return member;
}
