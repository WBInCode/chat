import { Queue } from "bullmq";
import { env } from "../config/env.js";

// BullMQ needs its own ioredis-compatible connection options (not the
// shared client instance) so it can manage blocking commands independently.
export const queueConnection = {
  host: new URL(env.REDIS_URL).hostname,
  port: Number(new URL(env.REDIS_URL).port || 6379)
};

export const FILE_SCAN_QUEUE = "file-scan";
export const FILE_PREVIEW_QUEUE = "file-preview";
export const LINK_UNFURL_QUEUE = "link-unfurl";

export interface FileScanJobData {
  fileId: string;
}

export interface FilePreviewJobData {
  fileId: string;
}

export interface LinkUnfurlJobData {
  messageId: string;
  channelId: string;
  url: string;
}

export const fileScanQueue = new Queue<FileScanJobData>(FILE_SCAN_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 }
  }
});

export const filePreviewQueue = new Queue<FilePreviewJobData>(FILE_PREVIEW_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 }
  }
});

export async function enqueueFileScan(fileId: string) {
  await fileScanQueue.add("scan", { fileId });
}

export async function enqueueFilePreview(fileId: string) {
  await filePreviewQueue.add("preview", { fileId });
}

export const linkUnfurlQueue = new Queue<LinkUnfurlJobData>(LINK_UNFURL_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 }
  }
});

export async function enqueueLinkUnfurl(data: LinkUnfurlJobData) {
  await linkUnfurlQueue.add("unfurl", data);
}

export const DATA_EXPORT_QUEUE = "data-export";
export const RETENTION_PURGE_QUEUE = "retention-purge";

export interface DataExportJobData {
  exportId: string;
}

export const dataExportQueue = new Queue<DataExportJobData>(DATA_EXPORT_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 200 }
  }
});

export async function enqueueDataExport(exportId: string) {
  await dataExportQueue.add("export", { exportId });
}

export const retentionPurgeQueue = new Queue(RETENTION_PURGE_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 50 }
  }
});

/**
 * Registers (idempotently) the daily repeatable job that purges messages
 * past each org's configured retention window. Safe to call on every boot
 * — BullMQ's job scheduler dedupes by id, it won't create duplicate
 * recurring jobs.
 */
export async function scheduleRetentionPurge() {
  await retentionPurgeQueue.upsertJobScheduler(
    "daily-retention-purge",
    { pattern: "0 3 * * *" }, // every day at 03:00 server time
    { name: "purge", data: {} }
  );
}

// ── F4-E: scheduled messages, reminders, status auto-expiry ────────────
// All three are "sweep due rows" jobs — cheap to run every minute since
// the actual due-check is a single indexed query, not per-row scheduling.
export const DUE_SWEEP_QUEUE = "due-sweep";

export const dueSweepQueue = new Queue(DUE_SWEEP_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 20 },
    removeOnFail: { count: 20 }
  }
});

export async function scheduleDueSweep() {
  await dueSweepQueue.upsertJobScheduler(
    "minutely-due-sweep",
    { every: 60_000 }, // every minute
    { name: "sweep", data: {} }
  );
}

