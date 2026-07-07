import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Users, Settings } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api.js";
import { Icon } from "../../components/Icon.js";

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
  channelName: string | null;
  isDm: boolean;
  isAdmin: boolean;
  orgMembers: OrgMemberLite[];
  onClose: () => void;
  onRenamed: (name: string) => void;
  onArchived: () => void;
}

/** Modal listing a channel's members (add/remove for admins) plus a settings tab (rename/archive). */
export function ChannelMembersPanel({
  channelId,
  channelName,
  isDm,
  isAdmin,
  orgMembers,
  onClose,
  onRenamed,
  onArchived
}: ChannelMembersPanelProps) {
  const [tab, setTab] = useState<"members" | "settings">("members");
  const [members, setMembers] = useState<ChannelMemberDto[] | null>(null);
  const [addTarget, setAddTarget] = useState("");
  const [nameDraft, setNameDraft] = useState(channelName ?? "");
  const [confirmingArchive, setConfirmingArchive] = useState(false);
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

  async function saveName() {
    const normalized = nameDraft.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (normalized.length < 2) return;
    try {
      await apiFetch(`/channels/${channelId}`, { method: "PATCH", body: JSON.stringify({ name: normalized }) });
      onRenamed(normalized);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się zmienić nazwy");
    }
  }

  async function archive() {
    try {
      await apiFetch(`/channels/${channelId}/archive`, { method: "POST" });
      onArchived();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się zarchiwizować");
    }
  }

  const addableMembers = orgMembers.filter((m) => !members?.some((cm) => cm.userId === m.userId));

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-modal-pop glass-strong fixed left-1/2 top-1/2 z-50 w-96 -translate-x-1/2 -translate-y-1/2 space-y-3 p-5">
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            <button
              onClick={() => setTab("members")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm ${tab === "members" ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--text-dim)]"}`}
            >
              <Icon icon={Users} size={14} /> Członkowie
            </button>
            {isAdmin && !isDm && (
              <button
                onClick={() => setTab("settings")}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm ${tab === "settings" ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--text-dim)]"}`}
              >
                <Icon icon={Settings} size={14} /> Ustawienia
              </button>
            )}
          </div>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)]">
            <Icon icon={X} size={16} />
          </button>
        </div>

        {tab === "members" ? (
          <>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {members?.map((m) => (
                <div key={m.userId} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--border)]/30">
                  <div>
                    <span className="font-medium">{m.displayName}</span>{" "}
                    {m.role === "ADMIN" && <span className="text-xs text-[var(--warning)]">ADMIN</span>}
                  </div>
                  {isAdmin && m.role !== "ADMIN" && (
                    <button onClick={() => removeMember(m.userId)} className="text-xs text-[var(--danger)] hover:underline">
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
          </>
        ) : (
          <div className="space-y-4">
            <label className="block space-y-1 text-sm">
              <span className="text-[var(--text-dim)]">Nazwa kanału</span>
              <div className="flex gap-2">
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="flex-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2.5 py-1.5 text-sm outline-none"
                />
                <button onClick={saveName} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white">
                  Zapisz
                </button>
              </div>
            </label>

            <div className="space-y-2 border-t border-[var(--glass-border)] pt-3">
              <p className="text-sm text-[var(--text-dim)]">
                Zarchiwizowany kanał staje się tylko-do-odczytu i chowa się z domyślnego widoku listy kanałów.
              </p>
              {!confirmingArchive ? (
                <button
                  onClick={() => setConfirmingArchive(true)}
                  className="rounded-lg border border-[var(--danger)]/40 px-3 py-1.5 text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10"
                >
                  Archiwizuj kanał
                </button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={archive} className="rounded-lg bg-[var(--danger)] px-3 py-1.5 text-sm font-medium text-white">
                    Tak, archiwizuj
                  </button>
                  <button
                    onClick={() => setConfirmingArchive(false)}
                    className="rounded-lg px-3 py-1.5 text-sm text-[var(--text-dim)] hover:bg-[var(--border)]/40"
                  >
                    Anuluj
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      </div>
    </>,
    document.body
  );
}

