import { useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api.js";
import { Avatar } from "../../components/Avatar.js";
import { ConfirmDialog } from "../../components/Dialog.js";

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

interface Props {
  channelId: string;
  isDm: boolean;
  isAdmin: boolean;
  orgMembers: OrgMemberLite[];
}

/**
 * Zawartość zakładki "Członkowie" w ustawieniach kanału. Wydzielona z dawnego
 * osobnego panelu, żeby zarządzanie kanałem miało jedno miejsce zamiast dwóch
 * okien robiących częściowo to samo.
 */
export function ChannelMembersTab({ channelId, isDm, isAdmin, orgMembers }: Props) {
  const [members, setMembers] = useState<ChannelMemberDto[] | null>(null);
  const [addTarget, setAddTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<ChannelMemberDto | null>(null);

  function reload() {
    void apiFetch<ChannelMemberDto[]>(`/channels/${channelId}/members`).then(setMembers);
  }

  useEffect(reload, [channelId]);

  async function addMember() {
    if (!addTarget) return;
    setError(null);
    try {
      await apiFetch(`/channels/${channelId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: addTarget })
      });
      setAddTarget("");
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się dodać członka.");
    }
  }

  async function removeMember(member: ChannelMemberDto) {
    setError(null);
    try {
      await apiFetch(`/channels/${channelId}/members/${member.userId}`, { method: "DELETE" });
      setPendingRemoval(null);
      reload();
    } catch (e) {
      setPendingRemoval(null);
      setError(e instanceof ApiError ? e.message : "Nie udało się usunąć członka.");
    }
  }

  const addable = orgMembers.filter((m) => !members?.some((cm) => cm.userId === m.userId));

  return (
    <div className="space-y-4">
      {isAdmin && !isDm && (
        <div className="flex gap-2">
          <select
            value={addTarget}
            onChange={(e) => setAddTarget(e.target.value)}
            disabled={addable.length === 0}
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          >
            <option value="">
              {addable.length === 0 ? "Wszyscy z organizacji są już w kanale" : "Wybierz osobę do dodania…"}
            </option>
            {addable.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </select>
          <button
            onClick={addMember}
            disabled={!addTarget}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            <UserPlus size={14} /> Dodaj
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">
          {members ? `${members.length} ${members.length === 1 ? "osoba" : "osób"}` : "Wczytywanie…"}
        </p>
        <div className="space-y-0.5">
          {members?.map((m) => (
            <div
              key={m.userId}
              className="group flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--border)]/40"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Avatar userId={m.userId} displayName={m.displayName} size={28} />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-[var(--text)]">{m.displayName}</span>
                  <span className="block truncate text-xs text-[var(--text-dim)]">{m.email}</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {m.role === "ADMIN" && (
                  <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                    Administrator
                  </span>
                )}
                {isAdmin && !isDm && m.role !== "ADMIN" && (
                  <button
                    onClick={() => setPendingRemoval(m)}
                    title="Usuń z kanału"
                    className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-dim)] opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 touch:h-9 touch:w-9 touch:opacity-100"
                  >
                    <X size={14} />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {pendingRemoval && (
        <ConfirmDialog
          title={`Usunąć ${pendingRemoval.displayName} z kanału?`}
          message="Straci dostęp do kanału i jego historii. Możesz dodać tę osobę ponownie w każdej chwili."
          confirmLabel="Usuń z kanału"
          danger
          onConfirm={() => removeMember(pendingRemoval)}
          onCancel={() => setPendingRemoval(null)}
        />
      )}
    </div>
  );
}
