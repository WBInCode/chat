import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../../lib/api.js";

export interface LightboxImage {
  id: string;
  name: string;
}

/**
 * Full-screen image viewer with prev/next navigation across a set of images
 * (e.g. all images attached to one message). Full-resolution URLs are fetched
 * on demand and cached per id; neighbours are prefetched so paging feels
 * instant. Keyboard: ←/→ to page, Esc to close.
 */
export function Lightbox({
  images,
  index,
  onIndexChange,
  onClose
}: {
  images: LightboxImage[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const count = images.length;
  const current = images[index];

  const loadUrl = useCallback(
    async (fileId: string | undefined) => {
      if (!fileId) return;
      setUrls((prev) => {
        if (prev[fileId]) return prev; // already cached
        void apiFetch<{ url: string }>(`/files/${fileId}/url`).then((r) =>
          setUrls((p) => ({ ...p, [fileId]: r.url }))
        );
        return prev;
      });
    },
    []
  );

  // Load the current image plus its neighbours for instant paging.
  useEffect(() => {
    void loadUrl(images[index]?.id);
    void loadUrl(images[index - 1]?.id);
    void loadUrl(images[index + 1]?.id);
  }, [index, images, loadUrl]);

  const goPrev = useCallback(() => onIndexChange((index - 1 + count) % count), [index, count, onIndexChange]);
  const goNext = useCallback(() => onIndexChange((index + 1) % count), [index, count, onIndexChange]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && count > 1) goPrev();
      else if (e.key === "ArrowRight" && count > 1) goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, goPrev, goNext, onClose]);

  if (!current) return null;
  const url = urls[current.id];

  return createPortal(
    <div
      className="animate-modal-pop fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Podgląd zdjęcia ${index + 1} z ${count}`}
    >
      {/* Close */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Zamknij"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl leading-none text-white transition-colors hover:bg-white/20"
      >
        ×
      </button>

      {count > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            aria-label="Poprzednie zdjęcie"
            className="absolute left-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-3xl leading-none text-white transition-colors hover:bg-white/20"
          >
            ‹
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            aria-label="Następne zdjęcie"
            className="absolute right-4 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-3xl leading-none text-white transition-colors hover:bg-white/20"
          >
            ›
          </button>
        </>
      )}

      {url ? (
        <img
          src={url}
          alt={current.name}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[90vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl"
        />
      ) : (
        <div className="text-sm text-white/70">Ładowanie…</div>
      )}

      {count > 1 && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white">
          {index + 1} / {count}
        </div>
      )}
    </div>,
    document.body
  );
}
