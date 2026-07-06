import { Worker, type Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "../lib/s3.js";
import { env } from "../config/env.js";
import { queueConnection, DATA_EXPORT_QUEUE, type DataExportJobData } from "../lib/queue.js";
import { logAudit } from "../lib/audit.js";

/**
 * Streams a set of named JSON files into a zip and uploads it to S3,
 * returning the object key. Uses archiver (pure JS, no native deps) so
 * this runs the same way on every deploy target.
 */
async function buildAndUploadZip(key: string, files: { name: string; content: unknown }[]) {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const passthrough = new PassThrough();
  archive.pipe(passthrough);

  const chunks: Buffer[] = [];
  passthrough.on("data", (chunk) => chunks.push(chunk));

  for (const file of files) {
    archive.append(JSON.stringify(file.content, null, 2), { name: file.name });
  }
  const finalized = archive.finalize();
  await new Promise<void>((resolve, reject) => {
    passthrough.on("end", resolve);
    passthrough.on("error", reject);
  });
  await finalized;

  const buffer = Buffer.concat(chunks);
  await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: buffer, ContentType: "application/zip" }));
  return key;
}

/**
 * Gathers every piece of personal data chatv2 holds about a user (GDPR
 * "right to access / data portability") and zips it. Scoped either to a
 * single org (admin-initiated export of one member) or across every org
 * the user belongs to (self-service "/me/export").
 */
export function registerDataExportWorker(fastify: FastifyInstance) {
  const worker = new Worker<DataExportJobData>(
    DATA_EXPORT_QUEUE,
    async (job: Job<DataExportJobData>) => {
      const { exportId } = job.data;
      const exportRow = await fastify.prisma.dataExport.findUnique({ where: { id: exportId } });
      if (!exportRow) return;

      try {
        const user = await fastify.prisma.user.findUnique({ where: { id: exportRow.targetUserId } });
        if (!user) throw new Error("Użytkownik nie istnieje");

        const orgFilter = exportRow.orgId
          ? { userId: exportRow.targetUserId, orgId: exportRow.orgId }
          : { userId: exportRow.targetUserId };
        const memberships = await fastify.prisma.membership.findMany({
          where: orgFilter,
          include: { org: true }
        });
        const orgIds = memberships.map((m) => m.orgId);

        const messages = await fastify.prisma.message.findMany({
          where: { authorId: exportRow.targetUserId, channel: { orgId: { in: orgIds } } },
          select: { id: true, channelId: true, content: true, contentType: true, createdAt: true, editedAt: true, deletedAt: true }
        });

        const files = await fastify.prisma.file.findMany({
          where: { uploaderId: exportRow.targetUserId, orgId: { in: orgIds } },
          select: { id: true, channelId: true, name: true, mimeType: true, size: true, status: true, createdAt: true }
        });

        const auditEntries = await fastify.prisma.auditLog.findMany({
          where: { actorId: exportRow.targetUserId, orgId: { in: orgIds } },
          select: { id: true, orgId: true, action: true, meta: true, createdAt: true }
        });

        const key = `exports/${exportId}.zip`;
        await buildAndUploadZip(key, [
          {
            name: "profile.json",
            content: {
              id: user.id,
              email: user.email,
              displayName: user.displayName,
              createdAt: user.createdAt,
              totpEnabled: user.totpEnabled
            }
          },
          {
            name: "memberships.json",
            content: memberships.map((m) => ({ org: m.org.name, role: m.role, joinedAt: m.createdAt }))
          },
          { name: "messages.json", content: messages },
          { name: "files.json", content: files },
          { name: "audit-log-actions.json", content: auditEntries }
        ]);

        await fastify.prisma.dataExport.update({
          where: { id: exportId },
          data: { status: "READY", key }
        });

        if (exportRow.orgId) {
          await logAudit(fastify, {
            orgId: exportRow.orgId,
            actorId: exportRow.requestedById,
            action: "member.data_exported",
            meta: { targetUserId: exportRow.targetUserId, exportId },
            ip: null
          });
        }
      } catch (err) {
        fastify.log.error({ err, exportId }, "Data export failed");
        await fastify.prisma.dataExport.update({
          where: { id: exportId },
          data: { status: "FAILED", error: (err as Error).message.slice(0, 500) }
        });
      }
    },
    { connection: queueConnection, concurrency: 2 }
  );

  fastify.addHook("onClose", async () => {
    await worker.close();
  });

  return worker;
}
