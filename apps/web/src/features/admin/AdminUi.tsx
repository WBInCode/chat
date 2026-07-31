import type { ReactNode } from "react";

/**
 * Wspólne elementy panelu administracyjnego. Wydzielone, bo każda zakładka
 * budowała nagłówek, tabelę i stan pusty po swojemu, przez co panel wyglądał
 * jak zlepek osobnych ekranów.
 */

export function TabHeader({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--glass-border)] pb-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
        {description && <p className="mt-0.5 max-w-prose text-xs text-[var(--text-dim)]">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * Tabela z własnym poziomym przewijaniem. Bez tego przy węższym oknie
 * ostatnia kolumna z przyciskami wychodziła poza panel, a pasek przewijania
 * lądował na samym dole wysokiego kontenera, więc akcje były nieosiągalne.
 */
export function TableWrap({ children, minWidth = 720 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
      <div style={{ minWidth }}>{children}</div>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--glass-border)] px-6 py-10 text-center">
      <p className="text-sm text-[var(--text)]">{title}</p>
      {description && <p className="max-w-sm text-xs text-[var(--text-dim)]">{description}</p>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]">
      {children}
    </p>
  );
}

const TONES = {
  neutral: "bg-[var(--border)]/60 text-[var(--text-dim)]",
  accent: "bg-[var(--accent)]/15 text-[var(--accent)]",
  good: "bg-[var(--accent-2)]/15 text-[var(--accent-2)]",
  warn: "bg-[var(--warning)]/15 text-[var(--warning)]",
  bad: "bg-[var(--danger)]/15 text-[var(--danger)]"
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Przycisk akcji w wierszu tabeli lub karcie. */
export function RowAction({
  onClick,
  disabled,
  title,
  danger,
  children
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`min-h-8 rounded-lg border border-[var(--glass-border)] px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 touch:min-h-10 ${
        danger
          ? "text-[var(--danger)] hover:border-[var(--danger)] hover:bg-[var(--danger)]/10"
          : "text-[var(--text-dim)] hover:border-[var(--accent)] hover:bg-[var(--border)]/50 hover:text-[var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}

export const adminSelect =
  "min-h-8 rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1 text-xs text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)] touch:min-h-10";
