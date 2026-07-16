import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChannelItem } from "../../stores/chat.js";

interface MemberLite {
  userId: string;
  displayName: string;
}

interface QuickSwitcherProps {
  channels: ChannelItem[];
  members: MemberLite[];
  onSelectChannel: (channelId: string) => void;
  onSelectMember: (userId: string) => void;
  onClose: () => void;
  /** Command-palette actions (navigate, create channel, logout, …). */
  actions?: Entry[];
}

interface Entry {
  key: string;
  label: string;
  icon: string;
  onSelect: () => void;
}

/** Ctrl+P command palette: jump to any channel/DM/member or run a command. */
export function QuickSwitcher({ channels, members, onSelectChannel, onSelectMember, onClose, actions = [] }: QuickSwitcherProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const entries = useMemo<Entry[]>(() => {
    const channelEntries: Entry[] = channels.map((c) => ({
      key: `c-${c.id}`,
      label: c.name ?? "",
      icon: c.type === "DM" ? "@" : c.type === "PRIVATE" ? "🔒" : "#",
      onSelect: () => onSelectChannel(c.id)
    }));
    const memberEntries: Entry[] = members.map((m) => ({
      key: `m-${m.userId}`,
      label: m.displayName,
      icon: "👤",
      onSelect: () => onSelectMember(m.userId)
    }));
    const all = [...channelEntries, ...memberEntries, ...actions];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 20);
    return all.filter((e) => e.label.toLowerCase().includes(q)).slice(0, 20);
  }, [channels, members, actions, query, onSelectChannel, onSelectMember]);

  useEffect(() => setActiveIndex(0), [query]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      entries[activeIndex]?.onSelect();
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  return createPortal(
    <>
      <div className="animate-overlay-in fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-modal-pop glass-strong fixed left-1/2 top-24 z-50 w-[28rem] -translate-x-1/2 overflow-hidden">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Przejdź do kanału, osoby lub uruchom komendę…"
          className="w-full border-b border-[var(--glass-border)] bg-transparent px-4 py-3 text-sm outline-none"
        />
        <div className="max-h-80 overflow-y-auto p-1.5">
          {entries.length === 0 && (
            <p className="px-3 py-2 text-sm text-[var(--text-dim)]">Brak wyników</p>
          )}
          {entries.map((entry, i) => (
            <button
              key={entry.key}
              onClick={entry.onSelect}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                i === activeIndex ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--text)]"
              }`}
            >
              <span>{entry.icon}</span>
              {entry.label}
            </button>
          ))}
        </div>
      </div>
    </>,
    document.body
  );
}
