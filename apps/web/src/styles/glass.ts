// Shared Tailwind class strings for the "liquid glass" design system.
// Centralised here so form inputs/buttons stay visually consistent across
// auth pages, settings, and the chat UI without repeating long strings.

export const glassInput =
  "w-full rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2.5 text-sm text-[var(--text)] outline-none backdrop-blur-sm transition-shadow duration-150 focus:ring-2 focus:ring-[var(--accent)]";

export const glassButtonPrimary =
  "w-full rounded-xl bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-white shadow-[0_4px_16px_rgba(91,124,255,0.35)] transition-all duration-150 hover:opacity-90 hover:shadow-[0_6px_20px_rgba(91,124,255,0.45)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100";

export const glassButtonGhost =
  "rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 text-sm font-medium text-[var(--text)] backdrop-blur-sm transition-all duration-150 hover:bg-[var(--border)]/40 active:scale-[0.98]";

export const glassCard = "w-full glass-strong p-8 animate-float-in";
