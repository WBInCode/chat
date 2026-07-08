import { useThemeStore, type ThemeMode, type Density } from "../../stores/theme.js";
import { glassCard } from "../../styles/glass.js";

const THEME_OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: "system", label: "Systemowy", hint: "Podąża za ustawieniem systemu" },
  { value: "light", label: "Jasny", hint: "Pastelowy liquid glass" },
  { value: "dark", label: "Ciemny", hint: "Granatowy liquid glass" },
  { value: "midnight", label: "Midnight", hint: "Czysta czerń OLED, bez rozmyć" }
];

const DENSITY_OPTIONS: { value: Density; label: string; hint: string }[] = [
  { value: "comfortable", label: "Komfortowy", hint: "Więcej przestrzeni" },
  { value: "compact", label: "Kompaktowy", hint: "Więcej treści na ekranie" }
];

/** Appearance section (F6-A): theme picker (incl. Midnight) + density toggle. */
export function AppearanceSettings() {
  const mode = useThemeStore((s) => s.mode);
  const density = useThemeStore((s) => s.density);
  const setMode = useThemeStore((s) => s.setMode);
  const setDensity = useThemeStore((s) => s.setDensity);

  return (
    <section className={glassCard}>
      <h2 className="mb-3 text-sm font-semibold">Wygląd</h2>

      <div className="mb-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">Motyw</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setMode(opt.value)}
              className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                mode === opt.value
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-[var(--glass-border)] hover:bg-[var(--border)]/40"
              }`}
            >
              <span className="block font-medium">{opt.label}</span>
              <span className="block text-[11px] text-[var(--text-dim)]">{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">Gęstość interfejsu</p>
        <div className="grid grid-cols-2 gap-2">
          {DENSITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDensity(opt.value)}
              className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                density === opt.value
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-[var(--glass-border)] hover:bg-[var(--border)]/40"
              }`}
            >
              <span className="block font-medium">{opt.label}</span>
              <span className="block text-[11px] text-[var(--text-dim)]">{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
