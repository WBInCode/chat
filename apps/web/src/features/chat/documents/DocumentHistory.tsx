import { useEffect, useState } from "react";
import { History, RotateCcw, X } from "lucide-react";
import type { DocumentBlockDto, DocumentDto, DocumentRevisionDto } from "@chatv2/shared";
import { Icon } from "../../../components/Icon.js";
import { ApiError, apiFetch } from "../../../lib/api.js";

interface DocumentHistoryProps {
  documentId: string;
  memberName: (userId: string) => string;
  onRestored: (document: DocumentDto) => void;
  onClose: () => void;
}

interface RevisionDetail {
  id: string;
  summary: string;
  createdAt: string;
  blocks: DocumentBlockDto[];
}

function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** One-line preview of a block, so the history reads as content, not as types. */
function describeBlock(block: DocumentBlockDto): string {
  switch (block.data.type) {
    case "heading":
      return block.data.text || "Pusty nagłówek";
    case "text":
      return block.data.text.slice(0, 120) || "Pusty akapit";
    case "table":
      return `Tabela ${block.data.header.length} x ${block.data.rows.length}: ${block.data.header.join(", ")}`;
    case "checklist": {
      const done = block.data.items.filter((i) => i.checked).length;
      return `Lista zadań, wykonane ${done} z ${block.data.items.length}`;
    }
    case "divider":
      return "Linia oddzielająca";
  }
}

export function DocumentHistory({ documentId, memberName, onRestored, onClose }: DocumentHistoryProps) {
  const [revisions, setRevisions] = useState<DocumentRevisionDto[] | null>(null);
  const [detail, setDetail] = useState<RevisionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiFetch<DocumentRevisionDto[]>(`/documents/${documentId}/revisions`)
      .then(setRevisions)
      .catch(() => setError("Nie udało się wczytać historii"));
  }, [documentId]);

  async function open(revisionId: string) {
    setError(null);
    try {
      setDetail(await apiFetch<RevisionDetail>(`/documents/${documentId}/revisions/${revisionId}`));
    } catch {
      setError("Nie udało się wczytać wersji");
    }
  }

  async function restore(revisionId: string) {
    setBusy(true);
    setError(null);
    try {
      onRestored(
        await apiFetch<DocumentDto>(`/documents/${documentId}/revisions/${revisionId}/restore`, {
          method: "POST"
        })
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się przywrócić wersji");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon icon={History} size={15} className="text-[var(--accent)]" /> Historia wersji
        </h3>
        <button onClick={onClose} aria-label="Zamknij historię" className="text-[var(--text-dim)] hover:text-[var(--text)]">
          <Icon icon={X} size={15} />
        </button>
      </div>

      {error && <p className="mb-2 text-xs text-[var(--danger)]">{error}</p>}
      {revisions === null && <p className="text-sm text-[var(--text-dim)]">Wczytywanie…</p>}
      {revisions?.length === 0 && (
        <p className="text-sm text-[var(--text-dim)]">
          Brak zapisanych wersji. Pierwsza powstanie przy kolejnej zmianie treści.
        </p>
      )}

      <ul className="space-y-1.5">
        {revisions?.map((rev) => (
          <li key={rev.id} className="rounded-lg border border-[var(--glass-border)] p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{rev.summary}</p>
                <p className="text-xs text-[var(--text-dim)]">
                  {formatMoment(rev.createdAt)}
                  {rev.authorId ? ` · ${memberName(rev.authorId)}` : ""} · {rev.blockCount} elem.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => void (detail?.id === rev.id ? setDetail(null) : open(rev.id))}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  {detail?.id === rev.id ? "Ukryj" : "Podgląd"}
                </button>
                <button
                  onClick={() => void restore(rev.id)}
                  disabled={busy}
                  className="flex items-center gap-1 text-xs text-[var(--text-dim)] hover:text-[var(--accent)] disabled:opacity-50"
                >
                  <Icon icon={RotateCcw} size={12} /> Przywróć
                </button>
              </div>
            </div>

            {detail?.id === rev.id && (
              <ol className="mt-2 space-y-1 border-t border-[var(--glass-border)] pt-2">
                {detail.blocks.map((block) => (
                  <li key={block.id} className="truncate text-xs text-[var(--text-dim)]">
                    {describeBlock(block)}
                  </li>
                ))}
                {detail.blocks.length === 0 && (
                  <li className="text-xs text-[var(--text-dim)]">Wersja bez treści.</li>
                )}
              </ol>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-[var(--text-dim)]">
        Przywrócenie zapisuje najpierw obecny stan jako nową wersję, więc zawsze można się cofnąć.
      </p>
    </div>
  );
}
