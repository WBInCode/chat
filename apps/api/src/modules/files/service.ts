import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { IMAGE_MIME_TYPES, type FileDto } from "@chatv2/shared";
import { s3, buildFileKey, buildThumbKey } from "../../lib/s3.js";
import { enqueueFileScan } from "../../lib/queue.js";
import { env } from "../../config/env.js";
import { assertChannelMember, notFound, HttpError } from "../../lib/authz.js";
import type { File as FileRow } from "@prisma/client";

const PRESIGN_TTL_SECONDS = 5 * 60;
const DOWNLOAD_TTL_SECONDS = 10 * 60;

function toDto(f: FileRow): FileDto {
  return {
    id: f.id,
    channelId: f.channelId,
    uploaderId: f.uploaderId,
    messageId: f.messageId,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size,
    status: f.status,
    width: f.width,
    height: f.height,
    hasThumb: !!f.thumbKey,
    previewStatus: f.previewStatus as FileDto["previewStatus"],
    createdAt: f.createdAt.toISOString()
  };
}

export function createFileService(fastify: FastifyInstance) {
  async function presign(
    userId: string,
    orgId: string,
    input: { channelId: string; name: string; size: number; mimeType: string }
  ) {
    await assertChannelMember(fastify, userId, input.channelId);

    const fileId = randomUUID();
    const key = buildFileKey(orgId, input.channelId, fileId, input.name);

    const record = await fastify.prisma.file.create({
      data: {
        id: fileId,
        orgId,
        channelId: input.channelId,
        uploaderId: userId,
        key,
        name: input.name,
        mimeType: input.mimeType,
        size: input.size,
        status: "PENDING"
      }
    });

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: input.mimeType }),
      { expiresIn: PRESIGN_TTL_SECONDS }
    );

    return { fileId: record.id, uploadUrl, expiresIn: PRESIGN_TTL_SECONDS };
  }

  /**
   * Called after the client's direct PUT to MinIO finishes. Verifies the
   * object actually landed with the declared size and, crucially, sniffs
   * the REAL content type from magic bytes rather than trusting the
   * client-declared mimeType (prevents e.g. an .html file impersonating a
   * .png to attempt stored-XSS if ever served inline).
   */
  async function complete(userId: string, fileId: string) {
    const file = await fastify.prisma.file.findUnique({ where: { id: fileId } });
    if (!file || file.uploaderId !== userId) notFound("Plik nie istnieje");
    await assertChannelMember(fastify, userId, file.channelId);

    const head = await s3
      .send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: file.key }))
      .catch(() => null);

    if (!head || head.ContentLength !== file.size) {
      await fastify.prisma.file.update({ where: { id: fileId }, data: { status: "FAILED" } });
      throw new HttpError(400, "UPLOAD_MISMATCH", "Przesłany plik nie zgadza się z deklaracją");
    }

    // Sniff first bytes to confirm the real type matches what was declared.
    const obj = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: file.key }));
    const chunks: Buffer[] = [];
    let total = 0;
    // @ts-expect-error - Body is a Node Readable in the Node runtime.
    for await (const chunk of obj.Body) {
      chunks.push(chunk);
      total += chunk.length;
      if (total > 4096) break; // only need the header for sniffing
    }
    const head8k = Buffer.concat(chunks);
    const detected = await fileTypeFromBuffer(head8k);

    // Plain text/csv/zip may not be reliably magic-byte detectable; only
    // hard-enforce the check for types file-type CAN detect (images, pdf,
    // office formats, zip).
    if (detected && detected.mime !== file.mimeType) {
      await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: file.key }));
      await fastify.prisma.file.update({ where: { id: fileId }, data: { status: "FAILED" } });
      throw new HttpError(400, "MIME_MISMATCH", "Zawartość pliku nie odpowiada deklarowanemu typowi");
    }

    let width: number | null = null;
    let height: number | null = null;
    let thumbKey: string | null = null;

    if ((IMAGE_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
      try {
        const fullObj = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: file.key }));
        const buf = Buffer.from(await fullObj.Body!.transformToByteArray());
        // Re-encode through sharp: strips EXIF/GPS metadata and any
        // non-image payload smuggled inside the file, and gives us a
        // trustworthy thumbnail + dimensions.
        const img = sharp(buf, { failOn: "error" });
        const meta = await img.metadata();
        width = meta.width ?? null;
        height = meta.height ?? null;

        const thumbBuf = await img
          .clone()
          .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();

        thumbKey = buildThumbKey(file.key);
        await s3.send(
          new PutObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: thumbKey,
            Body: thumbBuf,
            ContentType: "image/webp"
          })
        );
      } catch (err) {
        fastify.log.warn({ err, fileId }, "Thumbnail generation failed");
      }
    }

    // Virus scanning happens asynchronously (BullMQ worker, sprint F2-2) so
    // the upload response isn't blocked on a network round-trip to ClamAV.
    // The file stays PENDING — UI shows "scanning..." — until the worker
    // flips it to CLEAN/INFECTED and notifies connected clients over WS.
    const updated = await fastify.prisma.file.update({
      where: { id: fileId },
      data: { status: "PENDING", width, height, thumbKey }
    });

    await enqueueFileScan(fileId);

    return toDto(updated);
  }

  async function getDownloadUrl(
    userId: string,
    fileId: string,
    variant: "original" | "thumb" | "preview"
  ) {
    const file = await fastify.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) notFound("Plik nie istnieje");
    await assertChannelMember(fastify, userId, file.channelId);
    if (file.status === "INFECTED") {
      throw new HttpError(410, "FILE_INFECTED", "Plik został usunięty ze względów bezpieczeństwa");
    }
    // Full (non-thumbnail) downloads of non-image files wait for a clean
    // scan result — thumbnails/images are low-risk to preview immediately
    // since they're re-encoded through sharp, but arbitrary documents are
    // not touched until ClamAV clears them.
    const isImage = (IMAGE_MIME_TYPES as readonly string[]).includes(file.mimeType);
    if (!isImage && variant === "original" && file.status !== "CLEAN") {
      throw new HttpError(409, "FILE_SCANNING", "Plik jest jeszcze skanowany, spróbuj za chwilę");
    }

    if (variant === "preview") {
      // PDFs are their own preview; office docs need a converted previewKey.
      if (file.mimeType === "application/pdf") {
        if (file.status !== "CLEAN") {
          throw new HttpError(409, "FILE_SCANNING", "Plik jest jeszcze skanowany, spróbuj za chwilę");
        }
      } else if (!file.previewKey || file.previewStatus !== "READY") {
        throw new HttpError(409, "PREVIEW_NOT_READY", "Podgląd jeszcze się generuje, spróbuj za chwilę");
      }
    }

    const key =
      variant === "thumb" && file.thumbKey
        ? file.thumbKey
        : variant === "preview" && file.previewKey
          ? file.previewKey
          : file.key;

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        // Force download for non-images to prevent any inline rendering
        // (defense in depth against stored content-based attacks).
        ...(isImage && variant === "thumb"
          ? {}
          : variant === "preview"
            ? { ResponseContentDisposition: "inline" }
            : { ResponseContentDisposition: isImage ? "inline" : `attachment; filename="${file.name}"` })
      }),
      { expiresIn: DOWNLOAD_TTL_SECONDS }
    );

    return { url, expiresIn: DOWNLOAD_TTL_SECONDS };
  }

  async function attachToMessage(userId: string, fileIds: string[], messageId: string, channelId: string) {
    if (fileIds.length === 0) return;
    const files = await fastify.prisma.file.findMany({ where: { id: { in: fileIds } } });
    for (const f of files) {
      if (f.uploaderId !== userId || f.channelId !== channelId) {
        throw new HttpError(403, "FILE_OWNERSHIP", "Nie można załączyć cudzego pliku");
      }
    }
    await fastify.prisma.file.updateMany({
      where: { id: { in: fileIds } },
      data: { messageId }
    });
  }

  async function listForMessages(messageIds: string[]): Promise<Map<string, FileDto[]>> {
    if (messageIds.length === 0) return new Map();
    const files = await fastify.prisma.file.findMany({
      where: { messageId: { in: messageIds } },
      orderBy: { createdAt: "asc" }
    });
    const map = new Map<string, FileDto[]>();
    for (const f of files) {
      const list = map.get(f.messageId!) ?? [];
      list.push(toDto(f));
      map.set(f.messageId!, list);
    }
    return map;
  }

  return { presign, complete, getDownloadUrl, attachToMessage, listForMessages, toDto };
}

export type FileService = ReturnType<typeof createFileService>;
