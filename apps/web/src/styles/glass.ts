// Shared Tailwind class strings for the "liquid glass" design system.
// Centralised here so form inputs/buttons stay visually consistent across
// auth pages, settings, and the chat UI without repeating long strings.

export const glassInput =
  "w-full rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2.5 text-sm text-[var(--text)] outline-none backdrop-blur-sm transition-[box-shadow,border-color] duration-200 focus:border-[color-mix(in_srgb,var(--accent)_50%,var(--glass-border))] focus:ring-2 focus:ring-[var(--accent-ring)]";

export const glassButtonPrimary =
  "btn-gradient w-full rounded-xl px-3 py-2.5 text-sm font-medium text-white shadow-[0_4px_16px_var(--accent-glow)] transition-all duration-150 hover:shadow-[0_6px_24px_var(--accent-glow)] hover:brightness-[1.06] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100";

export const glassButtonGhost =
  "rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 text-sm font-medium text-[var(--text)] backdrop-blur-sm transition-all duration-150 hover:border-[color-mix(in_srgb,var(--accent)_30%,var(--glass-border))] hover:bg-[var(--border)]/40 active:scale-[0.98]";

export const glassCard = "w-full glass-strong p-8 animate-float-in";
