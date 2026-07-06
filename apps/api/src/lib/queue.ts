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
