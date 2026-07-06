import { usePresenceModeStore, type PresenceMode } from "../../stores/presenceMode.js";

const OPTIONS: { mode: PresenceMode | null; label: string; icon: string }[] = [
  { mode: null, label: "Dostępny (auto)", icon: "🟢" },
  { mode: "away", label: "Zaraz wracam", icon: "🟡" },
  { mode: "dnd", label: "Nie przeszkadzać", icon: "🔴" }
];

/** Manual presence override: auto (idle-based online/away), or forced away/DND. */
export function PresenceToggle() {
  const manual = usePresenceModeStore((s) => s.manual);
  const setManual = usePresenceModeStore((s) => s.setManual);

  return (
    <select
      value={manual ?? "auto"}
      onChange={(e) => setManual(e.target.value === "auto" ? null : (e.target.value as PresenceMode))}
      title="Status obecności"
      className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1 text-xs text-[var(--text)] backdrop-blur-sm transition-colors hover:bg-[var(--border)]/40"
    >
      {OPTIONS.map((o) => (
        <option key={o.mode ?? "auto"} value={o.mode ?? "auto"}>
          {o.icon} {o.label}
        </option>
      ))}
    </select>
  );
}
