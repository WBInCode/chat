import type { FastifyInstance } from "fastify";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DataExportDto } from "@chatv2/shared";
import { s3 } from "../../lib/s3.js";
import { env } from "../../config/env.js";
import { assertOrgPermission, notFound, HttpError } from "../../lib/authz.js";
import { sendError } from "../../lib/validation.js";
import { enqueueDataExport } from "../../lib/queue.js";

const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

async function toDto(fastify: FastifyInstance, row: {
  id: string;
  status: string;
  key: string | null;
  error: string | null;
  createdAt: Date;
  expiresAt: Date;
}): Promise<DataExportDto> {
  let downloadUrl: string | null = null;
  if (row.status === "READY" && row.key) {
    downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: row.key }),
      { expiresIn: 900 }
    );
  }
  return {
    id: row.id,
    status: row.status as DataExportDto["status"],
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    downloadUrl,
    error: row.error
  };
}

/**
 * GDPR data-export endpoints: self-service ("/me/export...") for a user's
 * own data across every org they belong to, plus an admin-initiated
 * export scoped to a single org+member (requires "org.export" permission,
 * OWNER-only per PERMISSION_MATRIX).
 */
export default async function exportRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return sendError(reply, error.status, error.code, error.message);
    }
    throw error;
  });

  fastify.post("/me/export", async (request) => {
    const userId = request.user!.id;
    const row = await fastify.prisma.dataExport.create({
      data: {
        orgId: null,
        requestedById: userId,
        targetUserId: userId,
        expiresAt: new Date(Date.now() + EXPORT_TTL_MS)
      }
    });
    await enqueueDataExport(row.id);
    return toDto(fastify, row);
  });

  fastify.get("/me/exports/:exportId", async (request) => {
    const { exportId } = request.params as { exportId: string };
    const row = await fastify.prisma.dataExport.findUnique({ where: { id: exportId } });
    if (!row || row.targetUserId !== request.user!.id) notFound("Eksport nie istnieje");
    return toDto(fastify, row);
  });

  fastify.post("/orgs/:orgId/admin/members/:userId/export", async (request) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string };
    const actor = await assertOrgPermission(fastify, request.user!.id, orgId, "org.export");

    const target = await fastify.prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId } } });
    if (!target) notFound("Członek nie istnieje");

    const row = await fastify.prisma.dataExport.create({
      data: {
        orgId,
        requestedById: actor.userId,
        targetUserId: userId,
        expiresAt: new Date(Date.now() + EXPORT_TTL_MS)
      }
    });
    await enqueueDataExport(row.id);
    return toDto(fastify, row);
  });

  fastify.get("/orgs/:orgId/admin/exports/:exportId", async (request) => {
    const { orgId, exportId } = request.params as { orgId: string; exportId: string };
    await assertOrgPermission(fastify, request.user!.id, orgId, "org.export");
    const row = await fastify.prisma.dataExport.findUnique({ where: { id: exportId } });
    if (!row || row.orgId !== orgId) notFound("Eksport nie istnieje");
    return toDto(fastify, row);
  });
}
