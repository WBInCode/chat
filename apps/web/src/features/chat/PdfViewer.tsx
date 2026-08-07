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
  const boxRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  // Powiekszenie wzgledem dopasowania do szerokosci, a nie skala bezwzgledna:
  // przy stalej skali strona A4 miala ~650 px i na telefonie wystawala poza ekran.
  const [zoom, setZoom] = useState(1);
  const [szerokoscOkna, setSzerokoscOkna] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerWidth
  );
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<import("pdfjs-dist").PDFDocumentLoadingTask | null>(null);

  useEffect(() => {
    const przelicz = () => setSzerokoscOkna(window.innerWidth);
    window.addEventListener("resize", przelicz);
    window.addEventListener("orientationchange", przelicz);
    return () => {
      window.removeEventListener("resize", przelicz);
      window.removeEventListener("orientationchange", przelicz);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        // Parametr v przelamuje pamiec przegladarek, ktore zapamietaly ten plik
        // z blednym typem application/octet-stream. Tresc workera sie nie
        // zmienila, wiec Vite generuje wciaz ta sama nazwe z odciskiem i bez
        // zmiany adresu nie ma powodu pobrac go ponownie.
        const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
        workerUrl.searchParams.set("v", "2");
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.toString();

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
      const canvas = canvasRef.current!;
      const naturalna = pdfPage.getViewport({ scale: 1 });
      const dostepna = Math.max(200, (boxRef.current?.clientWidth ?? naturalna.width) - 16);
      const viewport = pdfPage.getViewport({ scale: (dostepna / naturalna.width) * zoom });

      // Bitmapa w gestosci ekranu, rozmiar w CSS w punktach ukladu — inaczej
      // na telefonie z ekranem 3x tekst jest rozmyty.
      const gestosc = Math.min(window.devicePixelRatio || 1, 2);
      const ctx = canvas.getContext("2d")!;
      canvas.width = Math.floor(viewport.width * gestosc);
      canvas.height = Math.floor(viewport.height * gestosc);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      await pdfPage.render({
        canvasContext: ctx,
        viewport,
        canvas,
        ...(gestosc === 1 ? {} : { transform: [gestosc, 0, 0, gestosc, 0, 0] })
      }).promise;
    })();

    return () => {
      cancelled = true;
    };
  }, [page, zoom, numPages, szerokoscOkna]);

  return createPortal(
    <div
      className="animate-modal-pop fixed inset-0 z-50 flex flex-col items-center bg-black/80 backdrop-blur-md"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm text-white">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            aria-label="Poprzednia strona"
            className="shrink-0 rounded-md bg-white/10 px-3 py-1.5 disabled:opacity-30"
          >
            ‹
          </button>
          <span className="shrink-0 whitespace-nowrap tabular-nums">
            {page} / {numPages || "…"}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(numPages, p + 1))}
            disabled={page >= numPages}
            aria-label="Następna strona"
            className="shrink-0 rounded-md bg-white/10 px-3 py-1.5 disabled:opacity-30"
          >
            ›
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            aria-label="Pomniejsz"
            className="shrink-0 rounded-md bg-white/10 px-3 py-1.5"
          >
            −
          </button>
          <button
            onClick={() => setZoom(1)}
            aria-label="Dopasuj do szerokości"
            className="shrink-0 rounded-md bg-white/10 px-3 py-1.5 tabular-nums"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
            aria-label="Powiększ"
            className="shrink-0 rounded-md bg-white/10 px-3 py-1.5"
          >
            +
          </button>
        </div>
        <button onClick={onClose} className="shrink-0 rounded-md bg-white/10 px-3 py-1.5">
          Zamknij
        </button>
      </div>

      <div ref={boxRef} className="w-full flex-1 overflow-auto p-2 sm:p-4">
        {error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : (
          <canvas ref={canvasRef} className="mx-auto block shadow-2xl" />
        )}
      </div>
    </div>,
    document.body
  );
}
