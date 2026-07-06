import { S3Client, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";

export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: "us-east-1", // MinIO ignores region but the SDK requires one
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY
  },
  forcePathStyle: true // required for MinIO (bucket.domain vs domain/bucket)
});

/** Idempotently ensure the app's bucket exists. Safe to call on every boot. */
export async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  }
}

/** Builds a namespaced object key, isolating files per org/channel/file. */
export function buildFileKey(orgId: string, channelId: string, fileId: string, fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
  return `${orgId}/${channelId}/${fileId}/${safeName}`;
}

export function buildThumbKey(fileKey: string) {
  return `${fileKey}.thumb.webp`;
}

export function buildEmbedKey(id: string) {
  return `embeds/${id}`;
}
