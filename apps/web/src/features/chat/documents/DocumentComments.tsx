import { useCallback, useEffect, useState } from "react";
import { Check, MessageSquare, Trash2, X } from "lucide-react";
import type { DocumentCommentDto } from "@chatv2/shared";
import { Icon } from "../../../components/Icon.js";
import { ApiError, apiFetch } from "../../../lib/api.js";
import { getSocket } from "../../../lib/socket.js";

interface DocumentCommentsProps {
  documentId: string;
  currentUserId: string;
  memberName: (userId: string) => string;
  onClose: () => void;
}

function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function DocumentComments({
  documentId,
  currentUserId,
  memberName,
  onClose
}: DocumentCommentsProps) {
  const [comments, setComments] = useState<DocumentCommentDto[] | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const reload = useCallback(() => {
    void apiFetch<DocumentCommentDto[]>(`/documents/${documentId}/comments`)
      .then(setComments)
      .catch(() => setError("Nie udało się wczytać komentarzy"));
  }, [documentId]);

  useEffect(reload, [reload]);

  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (payload: { documentId: string; kind: string }) => {
      if (payload.documentId === documentId && payload.kind === "comments") reload();
    };
    socket.on("document:update", onUpdate);
    return () => {
      socket.off("document:update", onUpdate);
    };
  }, [documentId, reload]);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const created = await apiFetch<DocumentCommentDto>(`/documents/${documentId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: trimmed })
      });
      setComments((prev) => [...(prev ?? []), created]);
      setBody("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się dodać komentarza");
    }
  }

  async function toggleResolved(comment: DocumentCommentDto) {
    try {
      const updated = await apiFetch<DocumentCommentDto>(
        `/documents/${documentId}/comments/${comment.id}/resolve`,
        { method: "POST" }
      );
      setComments((prev) => prev?.map((c) => (c.id === updated.id ? updated : c)) ?? prev);
    } catch {
      reload();
    }
  }

  async function remove(commentId: string) {
    try {
      await apiFetch(`/documents/${documentId}/comments/${commentId}`, { method: "DELETE" });
      setComments((prev) => prev?.filter((c) => c.id !== commentId) ?? prev);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się usunąć komentarza");
    }
  }

  const visible = (comments ?? []).filter((c) => showResolved || !c.resolvedAt);
  const resolvedCount = (comments ?? []).filter((c) => c.resolvedAt).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between p-3 pb-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon icon={MessageSquare} size={15} className="text-[var(--accent)]" /> Komentarze
        </h3>
        <button onClick={onClose} aria-label="Zamknij komentarze" className="text-[var(--text-dim)] hover:text-[var(--text)]">
          <Icon icon={X} size={15} />
        </button>
      </div>

      {error && <p className="px-3 pb-2 text-xs text-[var(--danger)]">{error}</p>}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3">
        {comments === null && <p className="text-sm text-[var(--text-dim)]">Wczytywanie…</p>}
        {comments !== null && visible.length === 0 && (
          <p className="py-6 text-center text-sm text-[var(--text-dim)]">
            Brak komentarzy. Zadaj pytanie do treści dokumentu poniżej.
          </p>
        )}

        {visible.map((comment) => (
          <div
            key={comment.id}
            className={`rounded-lg border border-[var(--glass-border)] p-2.5 ${comment.resolvedAt ? "opacity-60" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-[var(--text-dim)]">
                {memberName(comment.authorId)} · {formatMoment(comment.createdAt)}
                {comment.resolvedAt && " · zamknięty"}
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() => void toggleResolved(comment)}
                  title={comment.resolvedAt ? "Otwórz ponownie" : "Oznacz jako zamknięty"}
                  aria-label={comment.resolvedAt ? "Otwórz ponownie" : "Oznacz jako zamknięty"}
                  className={comment.resolvedAt ? "text-[var(--accent-2)]" : "text-[var(--text-dim)] hover:text-[var(--accent-2)]"}
                >
                  <Icon icon={Check} size={13} />
                </button>
                {comment.authorId === currentUserId && (
                  <button
                    onClick={() => void remove(comment.id)}
                    aria-label="Usuń komentarz"
                    className="text-[var(--text-dim)] hover:text-[var(--danger)]"
                  >
                    <Icon icon={Trash2} size={13} />
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
          </div>
        ))}

        {resolvedCount > 0 && (
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            {showResolved ? "Ukryj zamknięte" : `Pokaż zamknięte (${resolvedCount})`}
          </button>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-[var(--glass-border)] p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Napisz komentarz"
          rows={2}
          maxLength={2000}
          aria-label="Treść komentarza"
          className="flex-1 resize-none rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1.5 text-sm outline-none"
        />
        <button
          onClick={() => void submit()}
          disabled={!body.trim()}
          className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Dodaj
        </button>
      </div>
    </div>
  );
}
