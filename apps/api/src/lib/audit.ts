import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";

interface AuditEntryInput {
  orgId: string;
  actorId: string | null;
  action: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * JSON.stringify with recursively sorted object keys. Postgres JSONB does
 * NOT preserve key insertion order, so hashing `JSON.stringify(obj)` as
 * written vs. as read back from the DB can produce different strings for
 * the exact same logical data — breaking the tamper-evidence chain on
 * false positives. Sorting keys before hashing makes the serialization
 * deterministic regardless of round-tripping through JSONB.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Appends a tamper-evident audit log entry. Each row's hash covers its own
 * content PLUS the previous row's hash (per org), forming a chain: editing
 * or deleting any historical entry breaks every hash after it, making
 * silent tampering with the trail detectable on verification.
 */
export async function logAudit(fastify: FastifyInstance, entry: AuditEntryInput) {
  const last = await fastify.prisma.auditLog.findFirst({
    where: { orgId: entry.orgId },
    orderBy: { createdAt: "desc" },
    select: { hash: true }
  });

  const prevHash = last?.hash ?? "genesis";
  const createdAt = new Date();
  const payload = stableStringify({
    orgId: entry.orgId,
    actorId: entry.actorId,
    action: entry.action,
    meta: entry.meta ?? {},
    createdAt: createdAt.toISOString(),
    prevHash
  });
  const hash = createHash("sha256").update(payload).digest("hex");

  return fastify.prisma.auditLog.create({
    data: {
      orgId: entry.orgId,
      actorId: entry.actorId,
      action: entry.action,
      meta: (entry.meta ?? {}) as Prisma.InputJsonValue,
      ip: entry.ip ?? null,
      prevHash,
      hash,
      createdAt
    }
  });
}

/** Recomputes the chain and reports the first broken link, if any. */
export async function verifyAuditChain(fastify: FastifyInstance, orgId: string) {
  const rows = await fastify.prisma.auditLog.findMany({
    where: { orgId },
    orderBy: { createdAt: "asc" }
  });

  let expectedPrev = "genesis";
  for (const row of rows) {
    const payload = stableStringify({
      orgId: row.orgId,
      actorId: row.actorId,
      action: row.action,
      meta: row.meta,
      createdAt: row.createdAt.toISOString(),
      prevHash: expectedPrev
    });
    const recomputed = createHash("sha256").update(payload).digest("hex");
    if (row.prevHash !== expectedPrev || row.hash !== recomputed) {
      return { valid: false, brokenAt: row.id };
    }
    expectedPrev = row.hash!;
  }
  return { valid: true, brokenAt: null };
}
