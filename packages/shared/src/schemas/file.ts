import { z } from "zod";

export const ALLOWED_FILE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
  "text/plain",
  "text/csv",
  "application/zip"
] as const;

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

// Office documents get converted to PDF (via Gotenberg) for in-app preview.
export const OFFICE_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
] as const;

export const PDF_MIME_TYPE = "application/pdf";

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

// An E2E attachment is uploaded as an opaque blob: the server sees only
// ciphertext, so it cannot be told what type it really is. The real name,
// type and decryption key travel inside the encrypted message body.
export const ENCRYPTED_FILE_MIME_TYPE = "application/octet-stream";

export const presignFileSchema = z
  .object({
    channelId: z.string().uuid(),
    name: z.string().trim().min(1).max(255),
    size: z
      .number()
      .int()
      .positive()
      // Ciphertext carries a small overhead (nonce + Poly1305 tag) on top of
      // the plaintext, so encrypted uploads get a little extra headroom.
      .max(MAX_FILE_SIZE_BYTES + 1024, "Plik jest za duży (limit 25 MB)"),
    mimeType: z.enum([...ALLOWED_FILE_MIME_TYPES, ENCRYPTED_FILE_MIME_TYPE]),
    /** True for client-side encrypted attachments in E2E conversations. */
    encrypted: z.boolean().default(false)
  })
  .refine((v) => !v.encrypted || v.mimeType === ENCRYPTED_FILE_MIME_TYPE, {
    message: "Zaszyfrowany załącznik musi być przesłany jako dane binarne"
  })
  .refine((v) => v.encrypted || v.mimeType !== ENCRYPTED_FILE_MIME_TYPE, {
    message: "Nieobsługiwany typ pliku"
  })
  .refine((v) => v.encrypted || v.size <= MAX_FILE_SIZE_BYTES, {
    message: "Plik jest za duży (limit 25 MB)"
  });
export type PresignFileInput = z.infer<typeof presignFileSchema>;

export interface FileDto {
  id: string;
  channelId: string;
  uploaderId: string;
  messageId: string | null;
  name: string;
  mimeType: string;
  size: number;
  status: "PENDING" | "CLEAN" | "INFECTED" | "FAILED";
  width: number | null;
  height: number | null;
  hasThumb: boolean;
  previewStatus: "NONE" | "PENDING" | "READY" | "FAILED";
  encrypted?: boolean;
  createdAt: string;
}
