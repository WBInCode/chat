import { Queue } from "bullmq";
import { env } from "../config/env.js";

// BullMQ needs its own ioredis-compatible connection options (not the
// shared client instance) so it can manage blocking commands independently.
const parsedUrl = new URL(env.REDIS_URL);
export const queueConnection = {
  host: parsedUrl.hostname,
  port: Number(parsedUrl.port || 6379),
  password: parsedUrl.password ? decodeURIComponent(parsedUrl.password) : undefined,
  username: parsedUrl.username || undefined,
  tls: parsedUrl.protocol === "rediss:" ? {} : undefined,
  maxRetriesPerRequest: null
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
 * Registers (idempotently) the recurring purge job: org retention windows
 * plus per-channel disappearing-message TTLs. Hourly so a 1h TTL is
 * honoured with reasonable latency (reads hide expired rows immediately;
 * this sweep makes the deletion physical). BullMQ's scheduler dedupes by
 * id — safe to call on every boot.
 */
export async function scheduleRetentionPurge() {
  await retentionPurgeQueue.upsertJobScheduler(
    "hourly-retention-purge",
    { pattern: "0 * * * *" }, // every hour, on the hour
    { name: "purge", data: {} }
  );
  // Drop the legacy daily scheduler if it exists from an older deploy.
  await retentionPurgeQueue.removeJobScheduler("daily-retention-purge").catch(() => {});
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

// ── Zbiorcze powiadomienia e-mail ──────────────────────────────────────
// Zadanie opóźnione, jedno na odbiorcę. Nie planujemy go dla każdej
// wiadomości — pilnuje tego znacznik w Redisie (patrz lib/email-digest.ts),
// dzięki czemu seria trzydziestu wiadomości tworzy jedno zadanie, nie
// trzydzieści.
export const EMAIL_DIGEST_QUEUE = "email-digest";

export interface EmailDigestJobData {
  userId: string;
}

export const emailDigestQueue = new Queue<EmailDigestJobData>(EMAIL_DIGEST_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 }
  }
});

export async function enqueueEmailDigest(data: EmailDigestJobData, delayMs: number) {
  await emailDigestQueue.add("digest", data, { delay: delayMs });
}

// Rozmowa głosowa bez odzewu. Zadanie planowane raz, przy zakładaniu pokoju,
// i sprawdzające po upływie okna, czy ktokolwiek dołączył.
export const VOICE_TIMEOUT_QUEUE = "voice-timeout";

/** Ile czekamy na dołączenie kogokolwiek, zanim rozmowa zostanie zakończona. */
export const VOICE_NO_ANSWER_MS = 3 * 60_000;

export interface VoiceTimeoutJobData {
  channelId: string;
  starterId: string;
}

export const voiceTimeoutQueue = new Queue<VoiceTimeoutJobData>(VOICE_TIMEOUT_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    // Ponowienie nie ma sensu: po nieudanej próbie warunek i tak zdąży się
    // zmienić, a druga wiadomość o braku odzewu byłaby myląca.
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 }
  }
});

export async function enqueueVoiceTimeout(data: VoiceTimeoutJobData, delayMs: number) {
  await voiceTimeoutQueue.add("timeout", data, { delay: delayMs });
}

