import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface PdfViewerProps {
  url: string;
  onClose: () => void;
}

/**
 * Minimal PDF viewer using pdf.js, lazy-loaded so the ~1MB library never
 * ships in the main bundle for users who never open a document preview.
 * Renders one page at a time to a <canvas> — JS execution embedded in a
 * PDF is never run (pdf.js does not execute PDF JavaScript by default).
 */
export function PdfViewer({ url, onClose }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.1);
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<import("pdfjs-dist").PDFDocumentLoadingTask | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();

        const loadingTask = pdfjsLib.getDocument({ url });
        loadingTaskRef.current = loadingTask;
        const doc = await loadingTask.promise;
        if (cancelled) return;
        docRef.current = doc;
        setNumPages(doc.numPages);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Nie można załadować PDF");
      }
    })();

    return () => {
      cancelled = true;
      void loadingTaskRef.current?.destroy();
    };
  }, [url]);

  useEffect(() => {
    if (!docRef.current || !canvasRef.current) return;
    let cancelled = false;

    void (async () => {
      const pdfPage = await docRef.current!.getPage(page);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale });
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await pdfPage.render({ canvasContext: ctx, viewport, canvas }).promise;
    })();

    return () => {
      cancelled = true;
    };
  }, [page, scale, numPages]);

  return createPortal(
    <div
      className="animate-modal-pop fixed inset-0 z-50 flex flex-col items-center bg-black/80 backdrop-blur-md"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex w-full items-center justify-between px-4 py-3 text-sm text-white">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-md bg-white/10 px-2 py-1 disabled:opacity-30"
          >
            ← Poprzednia
          </button>
          <span>
            {page} / {numPages || "…"}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(numPages, p + 1))}
            disabled={page >= numPages}
            className="rounded-md bg-white/10 px-2 py-1 disabled:opacity-30"
          >
            Następna →
          </button>
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.15))}
            className="rounded-md bg-white/10 px-2 py-1"
          >
            −
          </button>
          <button
            onClick={() => setScale((s) => Math.min(3, s + 0.15))}
            className="rounded-md bg-white/10 px-2 py-1"
          >
            +
          </button>
        </div>
        <button onClick={onClose} className="rounded-md bg-white/10 px-3 py-1">
          Zamknij ✕
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : (
          <canvas ref={canvasRef} className="shadow-2xl" />
        )}
      </div>
    </div>,
    document.body
  );
}
