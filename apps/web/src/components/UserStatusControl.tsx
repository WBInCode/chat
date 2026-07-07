import { useState } from "react";
import { createPortal } from "react-dom";
import { ChevronUp } from "lucide-react";
import { Avatar } from "./Avatar.js";
import { usePresenceModeStore, type PresenceMode } from "../stores/presenceMode.js";

const PRESENCE_OPTIONS: { mode: PresenceMode | null; label: string; dotClass: string }[] = [
  { mode: null, label: "Dostępny", dotClass: "bg-[var(--accent-2)]" },
  { mode: "away", label: "Zaraz wracam", dotClass: "bg-[var(--warning)]" },
  { mode: "dnd", label: "Nie przeszkadzać", dotClass: "bg-[var(--danger)]" }
];

interface UserStatusControlProps {
  userId: string;
  displayName: string;
  avatarUrl: string | null | undefined;
  myPresenceDotClass: string;
}

/**
 * Sidebar footer identity + presence control. Replaces the old top-bar
 * PresenceToggle dropdown: clicking the status dot next to the user's own
 * name opens a popover to switch presence mode — this is where users
 * expect it (bottom-left, next to their identity), not buried in the header.
 */
export function UserStatusControl({ userId, displayName, avatarUrl, myPresenceDotClass }: UserStatusControlProps) {
  const [open, setOpen] = useState(false);
  const manual = usePresenceModeStore((s) => s.manual);
  const setManual = usePresenceModeStore((s) => s.setManual);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--border)]/40"
      >
        <span className="relative shrink-0">
          <Avatar userId={userId} displayName={displayName} url={avatarUrl} size={28} />
          <span
            className={`absolute -bottom-0.5 -right-0.5 inline-block h-2.5 w-2.5 rounded-full ring-2 ring-[var(--bg)] transition-colors duration-300 ${myPresenceDotClass}`}
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{displayName}</span>
        <ChevronUp size={14} strokeWidth={1.75} className={`shrink-0 text-[var(--text-dim)] transition-transform ${open ? "" : "rotate-180"}`} />
      </button>

      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="animate-spring-in glass-strong fixed bottom-16 left-3 z-50 w-56 p-1.5">
              {PRESENCE_OPTIONS.map((opt) => (
                <button
                  key={opt.mode ?? "auto"}
                  onClick={() => {
                    setManual(opt.mode);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--border)]/40 ${
                    manual === opt.mode ? "text-[var(--accent)]" : "text-[var(--text)]"
                  }`}
                >
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${opt.dotClass}`} />
                  {opt.label}
                  {manual === opt.mode && <span className="ml-auto text-xs">✓</span>}
                </button>
              ))}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
