import { useEffect } from "react";
import { useThemeStore } from "../../stores/theme.js";

/** Sun/moon toggle with a smooth rotate transition between states. */
export function ThemeToggle() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  // Ensure the class is applied once on mount (in case of "system" changes
  // that occurred before the store subscribed).
  useEffect(() => {
    setMode(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <button
      onClick={() => setMode(isDark ? "light" : "dark")}
      title={isDark ? "Przełącz na jasny motyw" : "Przełącz na ciemny motyw"}
      className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-dim)] transition-all hover:bg-[var(--border)]/60 hover:text-[var(--text)]"
    >
      <span
        key={isDark ? "dark" : "light"}
        className="animate-spring-in inline-block text-sm"
      >
        {isDark ? "🌙" : "☀️"}
      </span>
    </button>
  );
}
