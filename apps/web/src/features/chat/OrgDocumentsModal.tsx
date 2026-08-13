import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, FileText, MessageSquare, Search } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api.js";
import { useOknoModalne } from "../../components/oknoModalne.js";

/**
 * Lista dokumentów ze wszystkich kanałów, do których użytkownik należy.
 * Moduł dokumentów miał wcześniej jedno wejście — nieopisaną ikonę w nagłówku
 * kanału — przez co był praktycznie nie do znalezienia.
 */

interface OrgDocumentDto {
  id: string;
  title: string;
  icon: string | null;
  channelId: string;
  channelName: string | null;
  blockCount: number;
  openCommentCount: number;
  updatedAt: string;
}

interface Props {
  orgId: string;
  onOpen: (channelId: string, documentId: string) => void;
  onClose: () => void;
}

function kiedy(iso: string): string {
  const minut = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minut < 1) return "przed chwilą";
  if (minut < 60) return `${minut} min temu`;
  const godzin = Math.round(minut / 60);
  if (godzin < 24) return `${godzin} godz. temu`;
  return new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "long" });
}

export function OrgDocumentsModal({ orgId, onOpen, onClose }: Props) {
  const [dokumenty, setDokumenty] = useState<OrgDocumentDto[] | null>(null);
  const [blad, setBlad] = useState<string | null>(null);
  const [fraza, setFraza] = useState("");
  const panelRef = useOknoModalne(onClose);

  useEffect(() => {
    void apiFetch<OrgDocumentDto[]>(`/orgs/${orgId}/documents`)
      .then(setDokumenty)
      .catch((e) => setBlad(e instanceof ApiError ? e.message : "Nie udało się wczytać dokumentów."));
  }, [orgId]);

  const widoczne = (dokumenty ?? []).filter((d) => {
    if (!fraza.trim()) return true;
    const s = fraza.trim().toLowerCase();
    return d.title.toLowerCase().includes(s) || (d.channelName ?? "").toLowerCase().includes(s);
  });

  return createPortal(
    <>
      <div className="animate-overlay-in fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Dokumenty organizacji"
        className="animate-modal-pop glass-strong fixed left-1/2 top-1/2 z-50 flex h-[min(80vh,34rem)] w-[36rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col p-5"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileText size={16} /> Dokumenty
          </h2>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            className="flex h-8 w-8 items-center justify-center rounded text-[var(--text-dim)] transition-colors hover:bg-[var(--border)]/40 hover:text-[var(--text)]"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mt-1 text-xs text-[var(--text-dim)]">
          Wspólne dokumenty z kanałów, do których należysz: tabele, ustalenia i listy zadań.
        </p>

        <div className="field-pill mt-3 flex items-center gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2.5 py-2">
          <Search size={14} className="shrink-0 text-[var(--text-dim)]" />
          <input
            value={fraza}
            onChange={(e) => setFraza(e.target.value)}
            placeholder="Szukaj po tytule lub kanale"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {blad && <p className="text-sm text-[var(--danger)]">{blad}</p>}
          {!blad && dokumenty === null && <p className="text-sm text-[var(--text-dim)]">Wczytywanie…</p>}

          {!blad && dokumenty !== null && widoczne.length === 0 && (
            <div className="rounded-lg border border-dashed border-[var(--glass-border)] px-5 py-8 text-center">
              <p className="text-sm">{fraza.trim() ? "Nic nie pasuje do wyszukiwania." : "Nie ma jeszcze żadnych dokumentów."}</p>
              {!fraza.trim() && (
                <p className="mt-1 text-xs text-[var(--text-dim)]">
                  Otwórz kanał i użyj przycisku <b>Dokumenty</b> w jego nagłówku, aby utworzyć pierwszy.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1">
            {widoczne.map((d) => (
              <button
                key={d.id}
                onClick={() => onOpen(d.channelId, d.id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--border)]/50"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[var(--text-dim)]">{d.icon ?? <FileText size={15} />}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{d.title}</span>
                    <span className="block truncate text-xs text-[var(--text-dim)]">
                      #{d.channelName ?? "kanał"} · {d.blockCount} {d.blockCount === 1 ? "element" : "elementów"} ·{" "}
                      {kiedy(d.updatedAt)}
                    </span>
                  </span>
                </span>
                {d.openCommentCount > 0 && (
                  <span className="flex shrink-0 items-center gap-1 rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                    <MessageSquare size={11} /> {d.openCommentCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
