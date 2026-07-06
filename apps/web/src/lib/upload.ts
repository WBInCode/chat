import { presignFileSchema, MAX_FILE_SIZE_BYTES, ALLOWED_FILE_MIME_TYPES } from "@chatv2/shared";
import { apiFetch } from "./api.js";

export interface UploadResult {
  fileId: string;
  name: string;
  mimeType: string;
}

export interface UploadProgress {
  name: string;
  progress: number; // 0..100
}

/**
 * Uploads a single file: presign -> direct PUT to MinIO (with progress via
 * XHR, since fetch doesn't expose upload progress) -> complete.
 * Rejects client-side for obviously invalid files before ever hitting the
 * network (server re-validates everything regardless).
 */
export async function uploadFile(
  file: File,
  channelId: string,
  onProgress?: (pct: number) => void
): Promise<UploadResult> {
  const parsed = presignFileSchema.safeParse({
    channelId,
    name: file.name,
    size: file.size,
    mimeType: file.type
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(issue?.message ?? "Nieprawidłowy plik");
  }

  const presign = await apiFetch<{ fileId: string; uploadUrl: string }>("/files/presign", {
    method: "POST",
    body: JSON.stringify(parsed.data)
  });

  await putWithProgress(presign.uploadUrl, file, onProgress);

  await apiFetch(`/files/${presign.fileId}/complete`, { method: "POST", body: "{}" });

  return { fileId: presign.fileId, name: file.name, mimeType: file.type };
}

function putWithProgress(url: string, file: File, onProgress?: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload nie powiódł się")));
    xhr.onerror = () => reject(new Error("Błąd sieci podczas wysyłania pliku"));
    xhr.send(file);
  });
}

export function isAllowedFileType(mimeType: string): boolean {
  return (ALLOWED_FILE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export { MAX_FILE_SIZE_BYTES };
