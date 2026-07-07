import client from "prom-client";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import {
  fileScanQueue,
  filePreviewQueue,
  linkUnfurlQueue,
  dataExportQueue,
  retentionPurgeQueue,
  dueSweepQueue
} from "./queue.js";

/**
 * Zero-cost observability (F5-F) — Prometheus text format via prom-client,
 * scraped by any free-tier collector (e.g. Grafana Cloud free tier,
 * self-hosted Prometheus) or just eyeballed directly. No paid APM/RUM.
 */

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new client.Counter({
  name: "chatv2_http_requests_total",
  help: "Total HTTP requests handled, labeled by method/route/status code",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry]
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: "chatv2_http_request_duration_seconds",
  help: "HTTP request duration in seconds, labeled by method/route/status",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry]
});

export const wsConnectionsGauge = new client.Gauge({
  name: "chatv2_ws_connections",
  help: "Current number of connected Socket.IO clients",
  registers: [registry]
});

export const aiQuotaUsedGauge = new client.Gauge({
  name: "chatv2_ai_quota_used",
  help: "AI requests consumed from today's free-tier daily budget",
  registers: [registry]
});

const queueWaitingGauge = new client.Gauge({
  name: "chatv2_queue_waiting_jobs",
  help: "Number of jobs waiting in a BullMQ queue",
  labelNames: ["queue"] as const,
  registers: [registry]
});

export const webVitalsHistogram = new client.Histogram({
  name: "chatv2_web_vitals",
  help: "Frontend Core Web Vitals reported via /rum, labeled by metric name",
  labelNames: ["name", "rating"] as const,
  // LCP/INP are in ms (buckets tuned for typical "good"/"needs-improvement" thresholds);
  // CLS is unitless (0-1ish) but shares the same histogram since prom-client buckets
  // are per-metric-name via labels, not global.
  buckets: [10, 50, 100, 200, 300, 500, 800, 1200, 1800, 2500, 4000, 6000],
  registers: [registry]
});

const QUEUES = [
  fileScanQueue,
  filePreviewQueue,
  linkUnfurlQueue,
  dataExportQueue,
  retentionPurgeQueue,
  dueSweepQueue
];

/** Registers a Fastify onResponse hook that records request count + latency for every route. */
export function instrumentHttp(fastify: FastifyInstance) {
  fastify.addHook("onResponse", (request, reply, done) => {
    const route = request.routeOptions?.url ?? request.url;
    const labels = { method: request.method, route, status: String(reply.statusCode) };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, reply.elapsedTime / 1000);
    done();
  });
}

/** Called just before serving /metrics — refreshes gauges that need an async read (queues, AI quota). */
export async function refreshAsyncGauges(fastify: FastifyInstance) {
  await Promise.all(
    QUEUES.map(async (q) => {
      try {
        const counts = await q.getJobCounts("waiting", "delayed");
        queueWaitingGauge.set({ queue: q.name }, (counts.waiting ?? 0) + (counts.delayed ?? 0));
      } catch {
        // queue backend (Redis) unreachable — leave stale value rather than crash /metrics
      }
    })
  );

  try {
    const key = `ai-quota:${new Date().toISOString().slice(0, 10)}`;
    const used = await fastify.redis.get(key);
    aiQuotaUsedGauge.set(used ? Number(used) : 0);
  } catch {
    // ignore — Redis unreachable
  }
}

export function setWsConnectionCount(count: number) {
  wsConnectionsGauge.set(count);
}

export const metricsEnabled = () => env.NODE_ENV !== "test";
