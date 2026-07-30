import { useCallback, useEffect, useState } from "react";
import { FileText, MessageSquare, Plus, Trash2, X } from "lucide-react";
import type { DocumentSummaryDto } from "@chatv2/shared";
import { Icon } from "../../../components/Icon.js";
import { ApiError, apiFetch } from "../../../lib/api.js";
import { getSocket } from "../../../lib/socket.js";
import { DocumentEditor } from "./DocumentEditor.js";

interface MemberLite {
  userId: string;
  displayName: string;
}

interface DocumentsPanelProps {
  channelId: string;
  currentUserId: string;
  members: MemberLite[];
  onClose: () => void;
}

function formatMoment(iso: string): string {
  const date = new Date(iso);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** Right-hand panel listing the channel's documents, with the editor inline. */
export function DocumentsPanel({ channelId, currentUserId, members, onClose }: DocumentsPanelProps) {
  const [items, setItems] = useState<DocumentSummaryDto[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    void apiFetch<DocumentSummaryDto[]>(`/channels/${channelId}/documents`)
      .then(setItems)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Nie udało się wczytać dokumentów"));
  }, [channelId]);

  useEffect(reload, [reload]);

  // The list shows counters and timestamps, so it has to react to edits made
  // by other people even while it sits in the background.
  useEffect(() => {
    const socket = getSocket();
    const onUpdate = () => {
      if (!openId) reload();
    };
    socket.on("document:update", onUpdate);
    return () => {
      socket.off("document:update", onUpdate);
    };
  }, [openId, reload]);

  async function create() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const created = await apiFetch<DocumentSummaryDto>(`/channels/${channelId}/documents`, {
        method: "POST",
        body: JSON.stringify({ title: trimmed })
      });
      setTitle("");
      setCreating(false);
      reload();
      setOpenId(created.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się utworzyć dokumentu");
    }
  }

  async function remove(documentId: string) {
    setError(null);
    try {
      await apiFetch(`/documents/${documentId}`, { method: "DELETE" });
      setItems((prev) => prev?.filter((d) => d.id !== documentId) ?? prev);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się usunąć dokumentu");
    }
  }

  return (
    <aside className="glass-strong fixed inset-0 z-40 flex flex-col overflow-hidden md:static md:z-auto md:w-[26rem] md:shrink-0">
      {openId ? (
        <DocumentEditor
          documentId={openId}
          currentUserId={currentUserId}
          members={members}
          onClose={() => {
            setOpenId(null);
            reload();
          }}
          onDeleted={() => {
            setOpenId(null);
            reload();
          }}
        />
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-[var(--glass-border)] p-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Icon icon={FileText} size={15} className="text-[var(--accent)]" /> Dokumenty
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCreating((v) => !v)}
                title="Nowy dokument"
                aria-label="Nowy dokument"
                className="text-[var(--text-dim)] hover:text-[var(--accent)]"
              >
                <Icon icon={Plus} size={16} />
              </button>
              <button
                onClick={onClose}
                aria-label="Zamknij"
                className="text-[var(--text-dim)] hover:text-[var(--text)]"
              >
                <Icon icon={X} size={16} />
              </button>
            </div>
          </div>

          {creating && (
            <div className="flex gap-2 border-b border-[var(--glass-border)] p-3">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder="Tytuł dokumentu"
                maxLength={200}
                aria-label="Tytuł nowego dokumentu"
                className="flex-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1.5 text-sm outline-none"
              />
              <button
                onClick={() => void create()}
                disabled={!title.trim()}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                Utwórz
              </button>
            </div>
          )}

          {error && <p className="px-3 py-2 text-xs text-[var(--danger)]">{error}</p>}

          <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
            {items === null && <p className="text-sm text-[var(--text-dim)]">Wczytywanie…</p>}
            {items?.length === 0 && (
              <p className="text-sm text-[var(--text-dim)]">
                Brak dokumentów w tym kanale. Utwórz pierwszy przyciskiem plus, aby zebrać w jednym
                miejscu tabele, ustalenia i listy zadań zespołu.
              </p>
            )}

            {items?.map((item) => (
              <div
                key={item.id}
                className="group flex items-center gap-2 rounded-lg border border-[var(--glass-border)] p-2.5"
              >
                <button onClick={() => setOpenId(item.id)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium">
                    {item.icon ? `${item.icon} ` : ""}
                    {item.title}
                  </p>
                  <p className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
                    <span>
                      {item.blockCount} {item.blockCount === 1 ? "element" : "elementów"}
                    </span>
                    <span>· {formatMoment(item.updatedAt)}</span>
                    {item.openCommentCount > 0 && (
                      <span className="flex items-center gap-0.5 text-[var(--accent)]">
                        <Icon icon={MessageSquare} size={11} /> {item.openCommentCount}
                      </span>
                    )}
                  </p>
                </button>
                <button
                  onClick={() => void remove(item.id)}
                  aria-label={`Usuń dokument ${item.title}`}
                  className="shrink-0 text-[var(--text-dim)] opacity-0 transition-opacity hover:text-[var(--danger)] group-hover:opacity-100 focus:opacity-100 touch:opacity-100"
                >
                  <Icon icon={Trash2} size={14} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
