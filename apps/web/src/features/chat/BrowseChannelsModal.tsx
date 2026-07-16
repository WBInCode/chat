import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Hash, Users } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api.js";
import { Icon } from "../../components/Icon.js";

interface BrowseChannelDto {
  id: string;
  name: string | null;
  type: "PUBLIC" | "PRIVATE";
  topic: string | null;
  memberCount: number;
  isMember: boolean;
  archivedAt: string | null;
}

interface BrowseChannelsModalProps {
  orgId: string;
  onClose: () => void;
  onJoined: (channelId: string) => void;
}

/** Modal to discover and self-join any PUBLIC channel in the org. */
export function BrowseChannelsModal({ orgId, onClose, onJoined }: BrowseChannelsModalProps) {
  const [channels, setChannels] = useState<BrowseChannelDto[] | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<BrowseChannelDto[]>(`/orgs/${orgId}/channels/browse`).then(setChannels);
  }, [orgId]);

  async function join(channelId: string) {
    setJoiningId(channelId);
    setError(null);
    try {
      await apiFetch(`/channels/${channelId}/join`, { method: "POST" });
      onJoined(channelId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się dołączyć");
    } finally {
      setJoiningId(null);
    }
  }

  const active = channels?.filter((c) => !c.archivedAt) ?? [];

  return createPortal(
    <>
      <div className="animate-overlay-in fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-modal-pop glass-strong fixed left-1/2 top-1/2 z-50 w-96 max-w-[92vw] -translate-x-1/2 -translate-y-1/2 space-y-3 p-5">
        <h2 className="text-sm font-semibold">Przeglądaj kanały publiczne</h2>

        <div className="max-h-80 space-y-1.5 overflow-y-auto">
          {channels === null && <p className="text-sm text-[var(--text-dim)]">Ładowanie…</p>}
          {active.length === 0 && channels !== null && (
            <p className="text-sm text-[var(--text-dim)]">Brak dostępnych kanałów publicznych.</p>
          )}
          {active.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--glass-border)] p-2.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon icon={Hash} size={14} />
                  {c.name}
                </div>
                <div className="flex items-center gap-1 text-xs text-[var(--text-dim)]">
                  <Icon icon={Users} size={11} />
                  {c.memberCount} {c.memberCount === 1 ? "członek" : "członków"}
                  {c.topic && <span className="truncate"> · {c.topic}</span>}
                </div>
              </div>
              {c.isMember ? (
                <span className="shrink-0 text-xs text-[var(--text-dim)]">Członek</span>
              ) : (
                <button
                  onClick={() => join(c.id)}
                  disabled={joiningId === c.id}
                  className="shrink-0 rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  {joiningId === c.id ? "…" : "Dołącz"}
                </button>
              )}
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex justify-end">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-[var(--text-dim)] hover:bg-[var(--border)]/40">
            Zamknij
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
