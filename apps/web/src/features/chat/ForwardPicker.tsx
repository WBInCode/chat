import { useState } from "react";
import { createPortal } from "react-dom";
import type { ChannelItem } from "../../stores/chat.js";

interface ForwardPickerProps {
  channels: ChannelItem[];
  onClose: () => void;
  onSubmit: (channelId: string, comment: string) => void;
}

/** Modal to pick a destination channel/DM and add an optional comment when forwarding a message. */
export function ForwardPicker({ channels, onClose, onSubmit }: ForwardPickerProps) {
  const [targetId, setTargetId] = useState(channels[0]?.id ?? "");
  const [comment, setComment] = useState("");

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-modal-pop glass-strong fixed left-1/2 top-1/2 z-50 w-96 -translate-x-1/2 -translate-y-1/2 space-y-3 p-5">
        <h2 className="text-sm font-semibold">↪️ Przekaż wiadomość</h2>
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="w-full rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1.5 text-sm outline-none"
        >
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.type === "DM" ? "@" : c.type === "PRIVATE" ? "🔒" : "#"} {c.name}
            </option>
          ))}
        </select>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Dodaj komentarz (opcjonalnie)"
          rows={2}
          className="w-full resize-none rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1.5 text-sm outline-none"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-[var(--text-dim)] hover:bg-[var(--border)]/40"
          >
            Anuluj
          </button>
          <button
            onClick={() => targetId && onSubmit(targetId, comment)}
            disabled={!targetId}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Przekaż
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
