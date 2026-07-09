import type { FastifyInstance } from "fastify";
import {
  MODULE_KEYS,
  CORE_MODULE_KEYS,
  DEFAULT_MODULE_STATE,
  type ModuleKey,
  type ModuleState
} from "@chatv2/shared";
import { HttpError } from "./authz.js";

const CACHE_TTL_SECONDS = 30;

function cacheKey(orgId: string) {
  return `org-modules:${orgId}`;
}

/**
 * Resolves the full module state for an organization: core modules are
 * always on; optional modules default to enabled unless an explicit
 * `OrganizationModule` override says otherwise (local admin toggle, or
 * synced from the wb-platform Hub's Entitlements API — see F7-C).
 *
 * Cached briefly in Redis so hot paths (WS gateway, per-request gating)
 * don't hit Postgres on every message. Invalidated by `invalidateModuleCache`
 * whenever an admin flips a toggle or a Hub webhook arrives.
 */
export async function getModuleState(fastify: FastifyInstance, orgId: string): Promise<ModuleState> {
  const cached = await fastify.redis.get(cacheKey(orgId));
  if (cached) {
    try {
      return JSON.parse(cached) as ModuleState;
    } catch {
      // fall through to recompute on corrupt cache
    }
  }

  const overrides = await fastify.prisma.organizationModule.findMany({ where: { orgId } });
  const state: ModuleState = { ...DEFAULT_MODULE_STATE };
  for (const key of CORE_MODULE_KEYS) state[key] = true;
  for (const o of overrides) {
    if ((MODULE_KEYS as readonly string[]).includes(o.moduleKey)) {
      const key = o.moduleKey as ModuleKey;
      if (CORE_MODULE_KEYS.includes(key)) continue; // core can never be disabled
      state[key] = o.enabled;
    }
  }

  await fastify.redis.set(cacheKey(orgId), JSON.stringify(state), "EX", CACHE_TTL_SECONDS);
  return state;
}

export async function invalidateModuleCache(fastify: FastifyInstance, orgId: string) {
  await fastify.redis.del(cacheKey(orgId));
}

export async function isModuleEnabled(
  fastify: FastifyInstance,
  orgId: string,
  key: ModuleKey
): Promise<boolean> {
  if (CORE_MODULE_KEYS.includes(key)) return true;
  const state = await getModuleState(fastify, orgId);
  return state[key] !== false;
}

/**
 * Gate for module-scoped routes/WS events. Deny-by-default posture matches
 * assertOrgPermission — throws a clean 403 (never a silent bypass) so the
 * client sees exactly why a feature is unavailable and can hide the UI.
 */
export async function assertModuleEnabled(
  fastify: FastifyInstance,
  orgId: string,
  key: ModuleKey
): Promise<void> {
  const enabled = await isModuleEnabled(fastify, orgId, key);
  if (!enabled) {
    throw new HttpError(403, "MODULE_DISABLED", `Moduł "${key}" jest wyłączony dla tej organizacji`);
  }
}
