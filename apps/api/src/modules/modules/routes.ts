import type { FastifyInstance } from "fastify";
import { setModuleSchema, MODULE_CATALOG, MODULE_KEYS } from "@chatv2/shared";
import { parseOrThrow } from "../../lib/validation.js";
import { assertOrgMember, assertOrgPermission } from "../../lib/authz.js";
import { getModuleState, invalidateModuleCache } from "../../lib/modules.js";
import { logAudit } from "../../lib/audit.js";

/**
 * Module toggles (F7-A): exposes the resolved module state to any org member
 * (so the client can hide disabled affordances — same pattern as /ai/status),
 * and lets admins flip OPTIONAL modules on/off for their organization.
 *
 * When the org is Hub-linked (F7-C), the Hub's Entitlements API is the
 * source of truth and overwrites these rows via webhook; local toggles then
 * only matter until the next sync. That distinction is surfaced via the
 * `source` field ("local" | "hub") on each override.
 */
export default async function modulesRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  /** Full resolved module state — any member of the org may read this. */
  fastify.get("/orgs/:orgId/modules", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await assertOrgMember(fastify, request.user!.id, orgId);
    return getModuleState(fastify, orgId);
  });

  /** Catalog metadata (labels/descriptions/core flag) — static, no org needed. */
  fastify.get("/modules/catalog", async () => {
    return MODULE_KEYS.map((key) => MODULE_CATALOG[key]);
  });

  /** Admin: toggle a single optional module for the organization. */
  fastify.patch("/orgs/:orgId/admin/modules", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const actor = await assertOrgPermission(fastify, request.user!.id, orgId, "org.settings");
    const input = parseOrThrow(setModuleSchema, request.body);

    await fastify.prisma.organizationModule.upsert({
      where: { orgId_moduleKey: { orgId, moduleKey: input.key } },
      update: { enabled: input.enabled, source: "local" },
      create: { orgId, moduleKey: input.key, enabled: input.enabled, source: "local" }
    });
    await invalidateModuleCache(fastify, orgId);

    await logAudit(fastify, {
      orgId,
      actorId: actor.userId,
      action: "module.toggled",
      meta: { key: input.key, enabled: input.enabled },
      ip: request.ip
    });

    return getModuleState(fastify, orgId);
  });
}
