// Shared Tailwind class strings for the corporate design system.
// Centralised here so form inputs/buttons stay visually consistent across
// auth pages, settings, and the chat UI without repeating long strings.

export const glassInput =
  "w-full rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-[box-shadow,border-color] duration-150 focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]";

export const glassButtonPrimary =
  "btn-gradient w-full rounded-lg px-3 py-2.5 text-sm font-medium text-white transition-colors duration-150 active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100";

export const glassButtonGhost =
  "rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 text-sm font-medium text-[var(--text)] transition-colors duration-150 hover:border-[var(--accent)] hover:bg-[var(--border)]/40 active:scale-[0.99]";

export const glassCard = "w-full glass-strong p-8 animate-float-in";
