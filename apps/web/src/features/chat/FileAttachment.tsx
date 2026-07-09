import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { FileDto } from "@chatv2/shared";
import { apiFetch } from "../../lib/api.js";
import { PdfViewer } from "./PdfViewer.js";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/ogg", "video/quicktime"]);
const PREVIEWABLE_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mimeType: string): string {
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.includes("wordprocessingml")) return "📝";
  if (mimeType.includes("spreadsheetml")) return "📊";
  if (mimeType.includes("presentationml")) return "📽️";
  if (mimeType === "application/zip") return "🗜️";
  return "📎";
}

/** One attachment row: image → thumbnail + lightbox; other → download card. */
export function FileAttachment({
  file,
  gallery = false,
  onImageOpen
}: {
  file: FileDto;
  gallery?: boolean;
  /** When provided, clicking an image thumbnail delegates to a shared gallery
   *  lightbox (with prev/next) instead of opening this attachment's own. */
  onImageOpen?: () => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const isImage = IMAGE_TYPES.has(file.mimeType);
  const isVideo = VIDEO_TYPES.has(file.mimeType);
  const isPreviewable = PREVIEWABLE_TYPES.has(file.mimeType);

  useEffect(() => {
    if (!isImage || !file.hasThumb) return;
    let cancelled = false;
    void apiFetch<{ url: string }>(`/files/${file.id}/url?variant=thumb`).then((r) => {
      if (!cancelled) setThumbUrl(r.url);
    });
    return () => {
      cancelled = true;
    };
  }, [file.id, file.hasThumb, isImage]);

  useEffect(() => {
    if (!isVideo || file.status !== "CLEAN") return;
    let cancelled = false;
    void apiFetch<{ url: string }>(`/files/${file.id}/url`).then((r) => {
      if (!cancelled) setVideoUrl(r.url);
    });
    return () => {
      cancelled = true;
    };
  }, [file.id, isVideo, file.status]);

  async function openLightbox() {
    const r = await apiFetch<{ url: string }>(`/files/${file.id}/url`);
    setLightboxUrl(r.url);
  }

  async function download() {
    const r = await apiFetch<{ url: string }>(`/files/${file.id}/url`);
    window.open(r.url, "_blank", "noopener,noreferrer");
  }

  async function openPreview() {
    setPreviewError(null);
    try {
      const r = await apiFetch<{ url: string }>(`/files/${file.id}/url?variant=preview`);
      setPreviewUrl(r.url);
    } catch {
      setPreviewError("Podgląd jeszcze się generuje, spróbuj za chwilę");
    }
  }

  const previewGenerating =
    file.mimeType !== "application/pdf" &&
    (file.previewStatus === "PENDING" || file.previewStatus === "NONE");
  const previewFailed = file.previewStatus === "FAILED";

  if (file.status === "INFECTED") {
    return (
      <div className="mt-1 rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">
        Plik został usunięty ze względów bezpieczeństwa.
      </div>
    );
  }

  if (isImage) {
    return (
      <>
        <button
          onClick={onImageOpen ?? openLightbox}
          className={
            gallery
              ? "block aspect-square overflow-hidden rounded-lg border border-[var(--border)]"
              : "mt-1 block max-w-xs overflow-hidden rounded-lg border border-[var(--border)]"
          }
        >
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={file.name}
              className={
                gallery
                  ? "h-full w-full object-cover"
                  : "max-h-64 w-auto object-cover"
              }
            />
          ) : (
            <div className="flex h-32 w-48 items-center justify-center text-xs text-[var(--text-dim)]">
              {file.status === "PENDING" ? "Przetwarzanie..." : "Podgląd niedostępny"}
            </div>
          )}
        </button>
        {lightboxUrl &&
          createPortal(
            <div
              className="animate-modal-pop fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md"
              onClick={() => setLightboxUrl(null)}
            >
              <img
                src={lightboxUrl}
                alt={file.name}
                className="max-h-[90vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl"
              />
            </div>,
            document.body
          )}
      </>
    );
  }

  if (isVideo) {
    if (file.status !== "CLEAN") {
      return (
        <div className="mt-1 flex h-32 w-48 items-center justify-center rounded-lg border border-[var(--border)] text-xs text-[var(--text-dim)]">
          {file.status === "PENDING" ? "Skanowanie..." : "Wideo niedostępne"}
        </div>
      );
    }
    return (
      <div className="mt-1 max-w-sm overflow-hidden rounded-lg border border-[var(--border)]">
        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            preload="metadata"
            className="max-h-72 w-full bg-black"
          />
        ) : (
          <div className="flex h-40 w-64 items-center justify-center text-xs text-[var(--text-dim)]">
            Ładowanie wideo...
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={download}
        className="mt-1 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-xs hover:bg-[var(--border)]/30"
      >
        <span className="text-lg">{fileIcon(file.mimeType)}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{file.name}</span>
          <span className="text-[var(--text-dim)]">
            {formatBytes(file.size)}
            {file.status === "PENDING" && " · skanowanie..."}
          </span>
        </span>
      </button>

      {isPreviewable && file.status === "CLEAN" && (
        <button
          onClick={openPreview}
          disabled={previewGenerating}
          className="ml-1 mt-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:cursor-not-allowed disabled:text-[var(--text-dim)]"
        >
          {previewGenerating ? "Generowanie podglądu..." : previewFailed ? "Podgląd niedostępny" : "👁 Podgląd"}
        </button>
      )}
      {previewError && <p className="mt-1 text-xs text-[var(--danger)]">{previewError}</p>}

      {previewUrl && <PdfViewer url={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </>
  );
}
