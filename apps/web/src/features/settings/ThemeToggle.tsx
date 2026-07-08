import { useEffect } from "react";
import { Sun, Moon, MoonStar } from "lucide-react";
import { useThemeStore } from "../../stores/theme.js";

/** Cycles light → dark → midnight → light with a smooth transition. */
export function ThemeToggle() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  // Ensure the class is applied once on mount (in case of "system" changes
  // that occurred before the store subscribed).
  useEffect(() => {
    setMode(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effective: "light" | "dark" | "midnight" =
    mode === "midnight"
      ? "midnight"
      : mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
        ? "dark"
        : "light";

  const next: Record<typeof effective, "light" | "dark" | "midnight"> = {
    light: "dark",
    dark: "midnight",
    midnight: "light"
  };
  const titles: Record<typeof effective, string> = {
    light: "Przełącz na ciemny motyw",
    dark: "Przełącz na motyw Midnight (OLED)",
    midnight: "Przełącz na jasny motyw"
  };

  return (
    <button
      onClick={() => setMode(next[effective])}
      title={titles[effective]}
      className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-dim)] transition-all hover:bg-[var(--border)]/60 hover:text-[var(--text)]"
    >
      <span key={effective} className="animate-spring-in inline-flex">
        {effective === "midnight" ? (
          <MoonStar size={16} strokeWidth={1.75} />
        ) : effective === "dark" ? (
          <Moon size={16} strokeWidth={1.75} />
        ) : (
          <Sun size={16} strokeWidth={1.75} />
        )}
      </span>
    </button>
  );
}
