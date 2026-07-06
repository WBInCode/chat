import type { FastifyInstance } from "fastify";
import { PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import type { User } from "@prisma/client";
import {
  updateProfileSchema,
  avatarPresignSchema,
  avatarCompleteSchema,
  type ProfileDto
} from "@chatv2/shared";
import { parseOrThrow } from "../../lib/validation.js";
import { HttpError, notFound } from "../../lib/authz.js";
import { sendError } from "../../lib/validation.js";
import { s3, buildAvatarRawKey, buildAvatarKey } from "../../lib/s3.js";
import { env } from "../../config/env.js";

const AVATAR_PRESIGN_TTL_SECONDS = 5 * 60;
const AVATAR_URL_TTL_SECONDS = 60 * 60;
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

async function resolveAvatarUrl(user: Pick<User, "avatarKey">) {
  if (!user.avatarKey) return null;
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: user.avatarKey }), {
    expiresIn: AVATAR_URL_TTL_SECONDS
  });
}

async function toProfileDto(user: User): Promise<ProfileDto> {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    jobTitle: user.jobTitle,
    department: user.department,
    phone: user.phone,
    statusText: user.statusText,
    statusEmoji: user.statusEmoji,
    avatarUrl: await resolveAvatarUrl(user),
    createdAt: user.createdAt.toISOString()
  };
}

/**
 * Profile self-service: edit personal fields (job title, department,
 * phone, status message/emoji) and upload/replace an avatar. Avatars are
 * stored privately in S3 like every other upload in this app (never a
 * publicly-guessable URL) and resolved to short-lived presigned GET URLs
 * on read — the same pattern used for message attachments.
 */
export default async function profileRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return sendError(reply, error.status, error.code, error.message);
    }
    throw error;
  });

  fastify.get("/me/profile", async (request) => {
    const user = await fastify.prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user) notFound("Użytkownik nie istnieje");
    return toProfileDto(user);
  });

  fastify.patch("/me/profile", async (request) => {
    const input = parseOrThrow(updateProfileSchema, request.body);
    // Strip undefined keys (exactOptionalPropertyTypes) — only fields the
    // client actually sent should be touched, `null` explicitly clears them.
    const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const user = await fastify.prisma.user.update({
      where: { id: request.user!.id },
      data
    });
    return toProfileDto(user);
  });

  // Batch resolver so the sidebar/message list can show avatars without
  // firing one request per member.
  fastify.post("/users/avatars", async (request) => {
    const { userIds } = request.body as { userIds: string[] };
    const ids = Array.isArray(userIds) ? userIds.slice(0, 200) : [];
    const users = await fastify.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, avatarKey: true }
    });
    const result: Record<string, string | null> = {};
    for (const u of users) {
      result[u.id] = await resolveAvatarUrl(u);
    }
    return result;
  });

  fastify.post("/me/avatar/presign", async (request) => {
    const input = parseOrThrow(avatarPresignSchema, request.body);
    const ext = EXT_BY_MIME[input.mimeType] ?? "bin";
    const key = buildAvatarRawKey(request.user!.id, ext);
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: input.mimeType }),
      { expiresIn: AVATAR_PRESIGN_TTL_SECONDS }
    );
    return { key, uploadUrl, expiresIn: AVATAR_PRESIGN_TTL_SECONDS };
  });

  fastify.post("/me/avatar/complete", async (request) => {
    const input = parseOrThrow(avatarCompleteSchema, request.body);
    const userId = request.user!.id;

    if (!input.key.startsWith(`avatars/raw/${userId}-`)) {
      throw new HttpError(403, "FORBIDDEN", "Nieprawidłowy klucz przesłanego pliku");
    }

    const head = await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: input.key })).catch(() => null);
    if (!head) throw new HttpError(400, "UPLOAD_MISMATCH", "Przesłany plik nie istnieje");

    const obj = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: input.key }));
    const buf = Buffer.from(await obj.Body!.transformToByteArray());

    const detected = await fileTypeFromBuffer(buf);
    if (!detected || !detected.mime.startsWith("image/")) {
      await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: input.key }));
      throw new HttpError(400, "MIME_MISMATCH", "Plik nie jest prawidłowym obrazem");
    }

    // Re-encoding through sharp strips EXIF/GPS metadata and normalizes
    // format/size regardless of what was uploaded.
    const resized = await sharp(buf)
      .resize(128, 128, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();

    const finalKey = buildAvatarKey(userId);
    await s3.send(
      new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: finalKey, Body: resized, ContentType: "image/webp" })
    );
    await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: input.key })).catch(() => {});

    const user = await fastify.prisma.user.update({ where: { id: userId }, data: { avatarKey: finalKey } });
    return toProfileDto(user);
  });

  fastify.delete("/me/avatar", async (request) => {
    const userId = request.user!.id;
    const user = await fastify.prisma.user.findUnique({ where: { id: userId } });
    if (user?.avatarKey) {
      await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: user.avatarKey })).catch(() => {});
    }
    const updated = await fastify.prisma.user.update({ where: { id: userId }, data: { avatarKey: null } });
    return toProfileDto(updated);
  });
}
