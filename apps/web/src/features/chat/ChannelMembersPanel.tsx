import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch, ApiError } from "../../lib/api.js";

interface ChannelMemberDto {
  userId: string;
  displayName: string;
  email: string;
  role: "ADMIN" | "MEMBER";
}

interface OrgMemberLite {
  userId: string;
  displayName: string;
}

interface ChannelMembersPanelProps {
  channelId: string;
  isAdmin: boolean;
  orgMembers: OrgMemberLite[];
  onClose: () => void;
}

/** Modal listing a channel's members, with add/remove for channel admins. */
export function ChannelMembersPanel({ channelId, isAdmin, orgMembers, onClose }: ChannelMembersPanelProps) {
  const [members, setMembers] = useState<ChannelMemberDto[] | null>(null);
  const [addTarget, setAddTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reload() {
    void apiFetch<ChannelMemberDto[]>(`/channels/${channelId}/members`).then(setMembers);
  }

  useEffect(reload, [channelId]);

  async function addMember() {
    if (!addTarget) return;
    try {
      await apiFetch(`/channels/${channelId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: addTarget })
      });
      setAddTarget("");
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się dodać członka");
    }
  }

  async function removeMember(userId: string) {
    try {
      await apiFetch(`/channels/${channelId}/members/${userId}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się usunąć członka");
    }
  }

  const addableMembers = orgMembers.filter((m) => !members?.some((cm) => cm.userId === m.userId));

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-modal-pop glass-strong fixed left-1/2 top-1/2 z-50 w-96 -translate-x-1/2 -translate-y-1/2 space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">👥 Członkowie kanału</h2>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)]">
            ✕
          </button>
        </div>

        <div className="max-h-64 space-y-1 overflow-y-auto">
          {members?.map((m) => (
            <div key={m.userId} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--border)]/30">
              <div>
                <span className="font-medium">{m.displayName}</span>{" "}
                {m.role === "ADMIN" && <span className="text-xs text-[var(--warning)]">ADMIN</span>}
              </div>
              {isAdmin && m.role !== "ADMIN" && (
                <button
                  onClick={() => removeMember(m.userId)}
                  className="text-xs text-[var(--danger)] hover:underline"
                >
                  Usuń
                </button>
              )}
            </div>
          ))}
        </div>

        {isAdmin && addableMembers.length > 0 && (
          <div className="flex gap-2 border-t border-[var(--glass-border)] pt-3">
            <select
              value={addTarget}
              onChange={(e) => setAddTarget(e.target.value)}
              className="flex-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1.5 text-sm outline-none"
            >
              <option value="">Wybierz osobę…</option>
              {addableMembers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </select>
            <button
              onClick={addMember}
              disabled={!addTarget}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Dodaj
            </button>
          </div>
        )}

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      </div>
    </>,
    document.body
  );
}
