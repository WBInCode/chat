import { useMemo, useState } from "react";
import { Check, Search, Users } from "lucide-react";
import { Avatar } from "./Avatar.js";

export interface PickableMember {
  userId: string;
  displayName: string;
  email?: string;
}

interface Props {
  members: PickableMember[];
  selected: string[];
  onChange: (userIds: string[]) => void;
  /** Osoby zablokowane na liście, np. twórca kanału. Zawsze zaznaczone. */
  lockedIds?: string[];
  emptyLabel?: string;
  maxHeightClass?: string;
}

/**
 * Wybór wielu osób z organizacji z filtrowaniem po nazwie i adresie.
 * Zastępuje pojedynczy `select`, który przy większym zespole był bezużyteczny.
 */
export function MemberPicker({
  members,
  selected,
  onChange,
  lockedIds = [],
  emptyLabel = "Brak osób do wybrania",
  maxHeightClass = "max-h-52"
}: Props) {
  const [query, setQuery] = useState("");
  const locked = useMemo(() => new Set(lockedIds), [lockedIds]);
  const chosen = useMemo(() => new Set(selected), [selected]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => m.displayName.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q)
    );
  }, [members, query]);

  function toggle(userId: string) {
    if (locked.has(userId)) return;
    onChange(chosen.has(userId) ? selected.filter((id) => id !== userId) : [...selected, userId]);
  }

  const selectedCount = selected.length + lockedIds.filter((id) => !chosen.has(id)).length;

  return (
    <div className="space-y-1.5">
      <div className="field-pill flex items-center gap-1.5 rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2.5 py-1.5">
        <Search size={13} className="shrink-0 text-[var(--text-dim)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Szukaj osoby"
          className="flex-1 bg-transparent text-sm outline-none"
        />
        <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--text-dim)]">
          <Users size={12} />
          {selectedCount}
        </span>
      </div>

      <div
        className={`${maxHeightClass} space-y-0.5 overflow-y-auto rounded-lg border border-[var(--glass-border)] p-1`}
      >
        {visible.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-[var(--text-dim)]">{emptyLabel}</p>
        )}
        {visible.map((m) => {
          const isLocked = locked.has(m.userId);
          const isChosen = isLocked || chosen.has(m.userId);
          return (
            <button
              key={m.userId}
              type="button"
              onClick={() => toggle(m.userId)}
              disabled={isLocked}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                isLocked
                  ? "cursor-default opacity-60"
                  : isChosen
                    ? "bg-[var(--accent)]/12 text-[var(--text)]"
                    : "text-[var(--text)] hover:bg-[var(--border)]/40"
              }`}
            >
              <Avatar userId={m.userId} displayName={m.displayName} size={22} />
              <span className="min-w-0 flex-1 truncate">
                {m.displayName}
                {isLocked && <span className="ml-1 text-xs text-[var(--text-dim)]">(Ty)</span>}
              </span>
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  isChosen
                    ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                    : "border-[var(--glass-border)]"
                }`}
              >
                {isChosen && <Check size={11} strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
