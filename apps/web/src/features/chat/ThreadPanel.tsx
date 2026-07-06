import { useEffect, useState, type FormEvent } from "react";
import type { MessageDto } from "@chatv2/shared";
import { apiFetch } from "../../lib/api.js";
import { getSocket } from "../../lib/socket.js";
import { MessageRow } from "./MessageRow.js";

interface MemberLite {
  userId: string;
  displayName: string;
}

interface ThreadPanelProps {
  parentMessageId: string;
  channelId: string;
  currentUserId: string;
  members: MemberLite[];
  onClose: () => void;
  onEdit: (messageId: string, content: string) => void;
  onDelete: (messageId: string) => void;
  onReact: (messageId: string, emoji: string) => void;
}

/** Right-hand slide-in panel showing a thread (parent + replies). */
export function ThreadPanel({
  parentMessageId,
  channelId,
  currentUserId,
  members,
  onClose,
  onEdit,
  onDelete,
  onReact
}: ThreadPanelProps) {
  const [parent, setParent] = useState<MessageDto | null>(null);
  const [replies, setReplies] = useState<MessageDto[]>([]);
  const [draft, setDraft] = useState("");

  const memberName = (id: string) =>
    members.find((m) => m.userId === id)?.displayName ?? "Nieznany";

  useEffect(() => {
    let cancelled = false;
    void apiFetch<{ parent: MessageDto; replies: MessageDto[] }>(
      `/messages/${parentMessageId}/thread`
    ).then((data) => {
      if (cancelled) return;
      setParent(data.parent);
      setReplies(data.replies);
    });
    return () => {
      cancelled = true;
    };
  }, [parentMessageId]);

  // Live updates: new replies to this thread arrive via message:new.
  useEffect(() => {
    const socket = getSocket();
    const onNew = (m: MessageDto) => {
      if (m.parentId === parentMessageId) {
        setReplies((prev) => (prev.some((r) => r.id === m.id) ? prev : [...prev, m]));
      }
    };
    socket.on("message:new", onNew);
    return () => {
      socket.off("message:new", onNew);
    };
  }, [parentMessageId]);

  function handleSend(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    getSocket().emit("message:send", {
      channelId,
      tempId: `temp-${crypto.randomUUID()}`,
      content,
      parentId: parentMessageId
    });
    setDraft("");
  }

  return (
    <aside className="glass animate-float-in flex w-80 shrink-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--glass-border)] px-4 py-3">
        <h2 className="text-sm font-semibold">Wątek</h2>
        <button
          onClick={onClose}
          className="rounded-lg px-2 py-0.5 text-sm text-[var(--text-dim)] transition-colors hover:bg-[var(--border)]/50 hover:text-[var(--text)]"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {parent && (
          <div className="border-b border-[var(--glass-border)] pb-3">
            <MessageRow
              message={parent}
              authorName={memberName(parent.authorId)}
              mine={parent.authorId === currentUserId}
              grouped={false}
              currentUserId={currentUserId}
              members={members}
              onEdit={onEdit}
              onDelete={onDelete}
              onReact={onReact}
              inThread
            />
          </div>
        )}
        {replies.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            authorName={memberName(m.authorId)}
            mine={m.authorId === currentUserId}
            grouped={false}
            currentUserId={currentUserId}
            members={members}
            onEdit={onEdit}
            onDelete={onDelete}
            onReact={onReact}
            inThread
          />
        ))}
        {replies.length === 0 && (
          <p className="text-xs text-[var(--text-dim)]">Brak odpowiedzi — rozpocznij wątek.</p>
        )}
      </div>

      <form onSubmit={handleSend} className="border-t border-[var(--glass-border)] p-3">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Odpowiedz w wątku..."
          maxLength={8000}
          className="w-full rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 text-sm outline-none backdrop-blur-sm focus:ring-2 focus:ring-[var(--accent)]"
        />
      </form>
    </aside>
  );
}
