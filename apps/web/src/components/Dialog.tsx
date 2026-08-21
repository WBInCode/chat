import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { useOknoModalne } from "./oknoModalne.js";

/**
 * Okna dialogowe aplikacji. Zastępują natywne window.prompt i window.confirm,
 * które wyglądały jak systemowy komunikat przeglądarki i całkowicie wypadały
 * z wyglądu reszty czatu.
 *
 * Oba warianty blokują przewijanie tła, zamykają się klawiszem Escape i
 * kliknięciem w tło, a po otwarciu ustawiają ognisko na polu lub przycisku
 * potwierdzenia, żeby dało się je obsłużyć z samej klawiatury.
 */

const OVERLAY = "animate-overlay-in fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm";
// Zakotwiczone blisko góry (nie wycentrowane) na mobile: przy otwartej klawiaturze
// prawdziwe wycentrowanie liczy się względem pełnego layout viewportu, więc dolna
// połowa panelu (przyciski Zapisz/Anuluj) ląduje pod klawiaturą. Od md w górę wraca
// klasyczne centrowanie, tam klawiatura nie zasłania ekranu.
const PANEL =
  "animate-modal-pop glass-strong fixed left-1/2 top-4 z-[61] w-[26rem] max-w-[92vw] max-h-[calc(100dvh-2rem)] -translate-x-1/2 space-y-4 overflow-y-auto p-5 md:top-1/2 md:-translate-y-1/2";
const CANCEL_BTN =
  "min-h-9 rounded-lg px-3 py-1.5 text-sm text-[var(--text-dim)] transition-colors hover:bg-[var(--border)]/40 hover:text-[var(--text)] touch:min-h-11";
const CONFIRM_BTN =
  "min-h-9 rounded-lg px-4 py-1.5 text-sm font-medium text-white transition-all disabled:cursor-not-allowed disabled:opacity-40 touch:min-h-11";

interface PromptDialogProps {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  maxLength?: number;
  /** Zwróć komunikat, żeby zablokować zatwierdzenie; null oznacza wartość poprawną. */
  validate?: (value: string) => string | null;
  onConfirm: (value: string) => void | Promise<void>;
  onCancel: () => void;
}

export function PromptDialog({
  title,
  label,
  initialValue = "",
  placeholder,
  confirmLabel = "Zapisz",
  maxLength = 60,
  validate,
  onConfirm,
  onCancel
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const panelRef = useOknoModalne(onCancel);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const validationError = validate ? validate(value) : value.trim() === "" ? "Podaj nazwę." : null;

  async function submit() {
    if (validationError || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(value.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się zapisać.");
      setBusy(false);
    }
  }

  return createPortal(
    <>
      <div className={OVERLAY} onClick={onCancel} />
      <div ref={panelRef} className={PANEL} role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>

        <label className="block space-y-1.5 text-sm">
          <span className="text-[var(--text-dim)]">{label}</span>
          <div className="field-pill flex items-center rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2.5 py-2">
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value.slice(0, maxLength))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={placeholder}
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
        </label>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className={CANCEL_BTN}>
            Anuluj
          </button>
          <button
            onClick={() => void submit()}
            disabled={!!validationError || busy}
            className={`btn-gradient ${CONFIRM_BTN}`}
          >
            {busy ? "Zapisywanie…" : confirmLabel}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}

interface ConfirmDialogProps {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /**
   * Gdy podane, potwierdzenie odblokowuje się dopiero po przepisaniu tego
   * tekstu. Używane tam, gdzie skutek jest nieodwracalny, żeby usunięcie
   * nie było kwestią jednego odruchowego kliknięcia.
   */
  requirePhrase?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Potwierdź",
  danger = false,
  requirePhrase,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const phraseRef = useRef<HTMLInputElement>(null);

  const panelRef = useOknoModalne(onCancel);

  useEffect(() => {
    if (requirePhrase) phraseRef.current?.focus();
    else confirmRef.current?.focus();
  }, [requirePhrase]);

  const blocked = !!requirePhrase && typed !== requirePhrase;

  async function submit() {
    if (blocked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się wykonać działania.");
      setBusy(false);
    }
  }

  return createPortal(
    <>
      <div className={OVERLAY} onClick={onCancel} />
      <div ref={panelRef} className={PANEL} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-start gap-3">
          {danger && (
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--danger)]/10 text-[var(--danger)]">
              <AlertTriangle size={16} />
            </span>
          )}
          <div className="min-w-0 space-y-1">
            <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
            <div className="text-sm text-[var(--text-dim)]">{message}</div>
          </div>
        </div>

        {requirePhrase && (
          <label className="block space-y-1.5 text-sm">
            <span className="text-[var(--text-dim)]">
              Wpisz <span className="font-medium text-[var(--text)]">{requirePhrase}</span>, aby potwierdzić
            </span>
            <input
              ref={phraseRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={requirePhrase}
              className="w-full rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2.5 py-2 text-sm outline-none focus:border-[var(--danger)]"
            />
          </label>
        )}

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className={CANCEL_BTN}>
            Anuluj
          </button>
          <button
            ref={confirmRef}
            onClick={() => void submit()}
            disabled={blocked || busy}
            className={`${CONFIRM_BTN} ${
              danger ? "bg-[var(--danger)] hover:brightness-110" : "btn-gradient"
            }`}
          >
            {busy ? "Chwileczkę…" : confirmLabel}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
