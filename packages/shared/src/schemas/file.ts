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

export const presignFileSchema = z.object({
  channelId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  size: z
    .number()
    .int()
    .positive()
    .max(MAX_FILE_SIZE_BYTES, "Plik jest za duży (limit 25 MB)"),
  mimeType: z.enum(ALLOWED_FILE_MIME_TYPES)
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
  createdAt: string;
}
