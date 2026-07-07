import Fastify from "fastify";
import type { FastifyError } from "fastify";
import { isProd, env } from "./config/env.js";
import prismaPlugin from "./plugins/prisma.js";
import redisPlugin from "./plugins/redis.js";
import securityPlugin from "./plugins/security.js";
import authGuardPlugin from "./plugins/auth-guard.js";
import healthRoutes from "./modules/health/routes.js";
import authRoutes from "./modules/auth/routes.js";
import orgRoutes, { inviteAcceptRoute } from "./modules/orgs/routes.js";
import channelRoutes from "./modules/channels/routes.js";
import messageRoutes from "./modules/messages/routes.js";
import searchRoutes from "./modules/search/routes.js";
import fileRoutes from "./modules/files/routes.js";
import embedRoutes from "./modules/embeds/routes.js";
import adminRoutes from "./modules/admin/routes.js";
import exportRoutes from "./modules/exports/routes.js";
import accountRoutes from "./modules/account/routes.js";
import profileRoutes from "./modules/profile/routes.js";
import notificationRoutes from "./modules/notifications/routes.js";
import productivityRoutes from "./modules/productivity/routes.js";
import wsGateway from "./ws/gateway.js";
import { ensureBucket } from "./lib/s3.js";
import { HttpError } from "./lib/authz.js";
import { ValidationError, sendError } from "./lib/validation.js";
import { registerFileScanWorker } from "./workers/file-scan.worker.js";
import { registerFilePreviewWorker } from "./workers/file-preview.worker.js";
import { registerLinkUnfurlWorker } from "./workers/link-unfurl.worker.js";
import { registerDataExportWorker } from "./workers/data-export.worker.js";
import { registerRetentionPurgeWorker } from "./workers/retention-purge.worker.js";
import { registerDueSweepWorker } from "./workers/due-sweep.worker.js";
import { scheduleRetentionPurge } from "./lib/queue.js";
import { scheduleDueSweep } from "./lib/queue.js";

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: isProd ? "info" : "debug",
      ...(isProd
        ? {}
        : {
            transport: {
              target: "pino-pretty",
              options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" }
            }
          }),
      // Never log sensitive fields (passwords, tokens, cookies).
      redact: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.passwordHash"]
    },
    trustProxy: true
  });

  // Global fallback: any module that doesn't register its own
  // setErrorHandler still gets consistent handling for validation and
  // authorization errors instead of leaking a raw 500.
  fastify.setErrorHandler((error: FastifyError | Error, _request, reply) => {
    if (error instanceof ValidationError) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Nieprawidłowe dane wejściowe");
    }
    if (error instanceof HttpError) {
      return sendError(reply, error.status, error.code, error.message);
    }
    // @fastify/sensible helpers (reply.unauthorized(), .forbidden(), ...)
    // and Fastify's own validation throw plain http-errors with a
    // statusCode — forward those as-is instead of masking as 500.
    const statusCode = "statusCode" in error ? error.statusCode : undefined;
    if (typeof statusCode === "number" && statusCode < 500) {
      return sendError(reply, statusCode, "REQUEST_ERROR", error.message);
    }
    fastify.log.error({ err: error }, "Unhandled error");
    return sendError(reply, 500, "INTERNAL_ERROR", "Wystąpił nieoczekiwany błąd");
  });

  await fastify.register(prismaPlugin);
  await fastify.register(redisPlugin);
  await fastify.register(securityPlugin);
  await fastify.register(authGuardPlugin);

  // MinIO may be temporarily unreachable in minimal demo deployments (e.g.
  // a quick preview environment without object storage configured yet) —
  // don't let that crash the whole API; file upload routes will simply
  // fail individually until storage is reachable.
  try {
    await ensureBucket();
  } catch (err) {
    fastify.log.warn({ err }, "S3/MinIO bucket check failed — file uploads will be unavailable");
  }

  await fastify.register(healthRoutes, { prefix: "/api/v1" });
  await fastify.register(authRoutes, { prefix: "/api/v1/auth" });
  await fastify.register(orgRoutes, { prefix: "/api/v1/orgs" });
  await fastify.register(inviteAcceptRoute, { prefix: "/api/v1/invites" });
  await fastify.register(channelRoutes, { prefix: "/api/v1" });
  await fastify.register(messageRoutes, { prefix: "/api/v1" });
  await fastify.register(searchRoutes, { prefix: "/api/v1" });
  await fastify.register(fileRoutes, { prefix: "/api/v1" });
  await fastify.register(embedRoutes, { prefix: "/api/v1" });
  await fastify.register(adminRoutes, { prefix: "/api/v1" });
  await fastify.register(exportRoutes, { prefix: "/api/v1" });
  await fastify.register(accountRoutes, { prefix: "/api/v1" });
  await fastify.register(profileRoutes, { prefix: "/api/v1" });
  await fastify.register(notificationRoutes, { prefix: "/api/v1" });
  await fastify.register(productivityRoutes, { prefix: "/api/v1" });
  await fastify.register(wsGateway);

  // Skipped under NODE_ENV=test: integration tests don't depend on async
  // virus scanning and shouldn't require a running ClamAV container.
  if (env.NODE_ENV !== "test") {
    registerFileScanWorker(fastify);
    registerFilePreviewWorker(fastify);
    registerLinkUnfurlWorker(fastify);
    registerDataExportWorker(fastify);
    registerRetentionPurgeWorker(fastify);
    registerDueSweepWorker(fastify);
    await scheduleRetentionPurge();
    await scheduleDueSweep();
  }

  return fastify;
}
