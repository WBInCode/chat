import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { s3 } from "../../lib/s3.js";
import { env } from "../../config/env.js";
import { registry, refreshAsyncGauges, webVitalsHistogram } from "../../lib/metrics.js";
import { parseOrThrow, sendError } from "../../lib/validation.js";
import { HttpError } from "../../lib/authz.js";

const rumSchema = z.object({
  name: z.enum(["LCP", "INP", "CLS", "FCP", "TTFB"]),
  value: z.number().nonnegative(),
  rating: z.enum(["good", "needs-improvement", "poor"])
});

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return sendError(reply, error.status, error.code, error.message);
    }
    throw error;
  });

  fastify.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  fastify.get("/health/ready", async (_request, reply) => {
    const checks: Record<string, "ok" | "error"> = {};

    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch (err) {
      fastify.log.error({ err }, "Readiness check: database failed");
      checks.database = "error";
    }

    try {
      await fastify.redis.ping();
      checks.redis = "ok";
    } catch (err) {
      fastify.log.error({ err }, "Readiness check: redis failed");
      checks.redis = "error";
    }

    try {
      await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
      checks.storage = "ok";
    } catch (err) {
      fastify.log.warn({ err }, "Readiness check: storage failed");
      checks.storage = "error";
    }

    const allOk = Object.values(checks).every((v) => v === "ok");
    return reply.status(allOk ? 200 : 503).send({ status: allOk ? "ready" : "not-ready", checks });
  });

  // Frontend Core Web Vitals beacon (F5-F) — free RUM alternative. No auth
  // (fired via navigator.sendBeacon before the user necessarily has a
  // fresh access token, e.g. on unload); global rate-limit plugin still
  // applies. Body is tiny and strictly validated, no user content stored.
  fastify.post("/rum", async (request, reply) => {
    const input = parseOrThrow(rumSchema, request.body);
    webVitalsHistogram.observe({ name: input.name, rating: input.rating }, input.value);
    return reply.status(204).send();
  });

  // Prometheus-format metrics (F5-F) — free-tier observability, no paid APM.
  // Skipped under NODE_ENV=test so test runs don't pull in queue/redis reads.
  if (env.NODE_ENV !== "test") {
    fastify.get("/metrics", async (_request, reply) => {
      await refreshAsyncGauges(fastify);
      reply.header("Content-Type", registry.contentType);
      return registry.metrics();
    });
  }
}

