import { useEffect, useState } from "react";
import type { MessageDto, SavedMessageDto } from "@chatv2/shared";
import { apiFetch } from "../../lib/api.js";
import { MessageRow } from "./MessageRow.js";

interface MemberLite {
  userId: string;
  displayName: string;
}

interface SavedPanelProps {
  currentUserId: string;
  members: MemberLite[];
  onClose: () => void;
  onToggleSave: (messageId: string) => void;
}

/** Right-hand panel listing every message the current user has bookmarked, across all channels. */
export function SavedPanel({ currentUserId, members, onClose, onToggleSave }: SavedPanelProps) {
  const [items, setItems] = useState<SavedMessageDto[] | null>(null);

  function reload() {
    void apiFetch<SavedMessageDto[]>("/me/saved-messages").then(setItems);
  }

  useEffect(reload, []);

  const memberName = (id: string) => members.find((m) => m.userId === id)?.displayName ?? "Nieznany";

  function handleToggleSave(messageId: string) {
    onToggleSave(messageId);
    setItems((prev) => (prev ? prev.filter((i) => i.message.id !== messageId) : prev));
  }

  return (
    <aside className="glass-strong flex w-80 shrink-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--glass-border)] p-3">
        <span className="text-sm font-semibold">🔖 Zapisane wiadomości</span>
        <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)]">
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {items === null && <p className="text-sm text-[var(--text-dim)]">Ładowanie…</p>}
        {items?.length === 0 && (
          <p className="text-sm text-[var(--text-dim)]">Brak zapisanych wiadomości. Kliknij 📑 przy wiadomości, aby ją zapisać.</p>
        )}
        {items?.map((item) => (
          <div key={item.message.id} className="rounded-lg border border-[var(--glass-border)] p-2">
            <MessageRow
              message={item.message}
              authorName={memberName(item.message.authorId)}
              mine={item.message.authorId === currentUserId}
              grouped={false}
              currentUserId={currentUserId}
              members={members}
              onEdit={() => {}}
              onDelete={() => {}}
              onReact={() => {}}
              onToggleSave={handleToggleSave}
              isSaved
              inThread
            />
          </div>
        ))}
      </div>
    </aside>
  );
}
