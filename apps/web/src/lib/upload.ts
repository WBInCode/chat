import {
  presignFileSchema,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_FILE_MIME_TYPES,
  ENCRYPTED_FILE_MIME_TYPE
} from "@chatv2/shared";
import { apiFetch } from "./api.js";
import { encryptFileBytes, type E2eFileRef } from "./e2e.js";

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

/**
 * E2E upload: the file is encrypted in the browser and only ciphertext
 * leaves the device. The server is told nothing beyond "an opaque blob of
 * N bytes" - the real name, type and key are returned here so the caller
 * can put them inside the ENCRYPTED message body.
 */
export async function uploadEncryptedFile(
  file: File,
  channelId: string,
  onProgress?: (pct: number) => void
): Promise<E2eFileRef> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("Plik jest za duży (limit 25 MB)");
  }
  if (!isAllowedFileType(file.type)) {
    throw new Error("Nieobsługiwany typ pliku");
  }

  const plain = new Uint8Array(await file.arrayBuffer());
  const { ciphertext, keyB64 } = encryptFileBytes(plain);
  const blob = new Blob([ciphertext as BlobPart], { type: ENCRYPTED_FILE_MIME_TYPE });

  const presign = await apiFetch<{ fileId: string; uploadUrl: string }>("/files/presign", {
    method: "POST",
    body: JSON.stringify({
      channelId,
      // Placeholder name: the real one never reaches the server.
      name: "attachment.bin",
      size: blob.size,
      mimeType: ENCRYPTED_FILE_MIME_TYPE,
      encrypted: true
    })
  });

  await putBlobWithProgress(presign.uploadUrl, blob, ENCRYPTED_FILE_MIME_TYPE, onProgress);
  await apiFetch(`/files/${presign.fileId}/complete`, { method: "POST", body: "{}" });

  return { id: presign.fileId, k: keyB64, n: file.name, m: file.type, s: file.size };
}

/** Fetches an encrypted attachment and returns its decrypted bytes. */
export async function downloadEncryptedFile(ref: E2eFileRef): Promise<Uint8Array | null> {
  const { url } = await apiFetch<{ url: string }>(`/files/${ref.id}/url`);
  const res = await fetch(url);
  if (!res.ok) return null;
  const { decryptFileBytes } = await import("./e2e.js");
  return decryptFileBytes(new Uint8Array(await res.arrayBuffer()), ref.k);
}

function putBlobWithProgress(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress?: (pct: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload nie powiódł się"));
    xhr.onerror = () => reject(new Error("Błąd sieci podczas wysyłania pliku"));
    xhr.send(blob);
  });
}

export { MAX_FILE_SIZE_BYTES };
