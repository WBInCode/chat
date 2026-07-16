import { useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch, ApiError } from "../../lib/api.js";

interface CreateChannelModalProps {
  orgId: string;
  onClose: () => void;
  onCreated: (channelId: string) => void;
}

/** Modal to create a new PUBLIC or PRIVATE channel. */
export function CreateChannelModal({ orgId, onClose, onCreated }: CreateChannelModalProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  async function create() {
    if (normalized.length < 2) return;
    setCreating(true);
    setError(null);
    try {
      const channel = await apiFetch<{ id: string }>(`/orgs/${orgId}/channels`, {
        method: "POST",
        body: JSON.stringify({ name: normalized, type })
      });
      onCreated(channel.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się utworzyć kanału");
    } finally {
      setCreating(false);
    }
  }

  return createPortal(
    <>
      <div className="animate-overlay-in fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-modal-pop glass-strong fixed left-1/2 top-1/2 z-50 w-96 max-w-[92vw] -translate-x-1/2 -translate-y-1/2 space-y-3 p-5">
        <h2 className="text-sm font-semibold">Utwórz kanał</h2>

        <label className="block space-y-1 text-sm">
          <span className="text-[var(--text-dim)]">Nazwa kanału</span>
          <div className="flex items-center gap-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2.5 py-2">
            <span className="text-[var(--text-dim)]">#</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="np. marketing"
              maxLength={80}
              className="flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          {name && normalized !== name.trim().toLowerCase() && (
            <p className="text-xs text-[var(--text-dim)]">Zostanie zapisany jako: #{normalized}</p>
          )}
        </label>

        <div className="space-y-1.5">
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--glass-border)] p-2.5 text-sm has-[:checked]:border-[var(--accent)]">
            <input type="radio" checked={type === "PUBLIC"} onChange={() => setType("PUBLIC")} className="mt-0.5 accent-[var(--accent)]" />
            <span>
              <span className="block font-medium"># Publiczny</span>
              <span className="block text-xs text-[var(--text-dim)]">Widoczny i dostępny dla wszystkich w organizacji</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--glass-border)] p-2.5 text-sm has-[:checked]:border-[var(--accent)]">
            <input type="radio" checked={type === "PRIVATE"} onChange={() => setType("PRIVATE")} className="mt-0.5 accent-[var(--accent)]" />
            <span>
              <span className="block font-medium">🔒 Prywatny</span>
              <span className="block text-xs text-[var(--text-dim)]">Tylko zaproszeni członkowie — dodasz ich po utworzeniu</span>
            </span>
          </label>
        </div>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-[var(--text-dim)] hover:bg-[var(--border)]/40">
            Anuluj
          </button>
          <button
            onClick={create}
            disabled={normalized.length < 2 || creating}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {creating ? "Tworzenie…" : "Utwórz kanał"}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
