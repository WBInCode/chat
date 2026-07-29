import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BarChart3, EyeOff, Plus, Smile, X } from "lucide-react";
import { POLL_MAX_OPTIONS } from "@chatv2/shared";
import { Icon } from "../../components/Icon.js";
import { EmojiPicker, type PickerAnchor } from "./EmojiPicker.js";

export interface NewPollInput {
  question: string;
  options: Array<{ text: string; emoji: string | null }>;
  allowMultiple: boolean;
  hideVoters: boolean;
  closesAt: string | null;
}

interface CreatePollModalProps {
  onClose: () => void;
  onSubmit: (input: NewPollInput) => void;
}

interface DraftOption {
  /** Stable key so React does not reuse inputs when a row is removed. */
  key: number;
  text: string;
  emoji: string | null;
}

/** Presets cover the realistic span of a workplace poll. */
const DURATIONS: Array<{ label: string; hours: number | null }> = [
  { label: "Bez terminu", hours: null },
  { label: "1 godzina", hours: 1 },
  { label: "6 godzin", hours: 6 },
  { label: "24 godziny", hours: 24 },
  { label: "3 dni", hours: 72 },
  { label: "7 dni", hours: 168 }
];

let nextKey = 0;
function blankOption(): DraftOption {
  return { key: nextKey++, text: "", emoji: null };
}

/**
 * Poll composer: question, 2 to 10 answers with optional emoji, single or
 * multiple choice, an optional deadline and a switch that hides who voted
 * for what.
 */
export function CreatePollModal({ onClose, onSubmit }: CreatePollModalProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<DraftOption[]>([blankOption(), blankOption()]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [hideVoters, setHideVoters] = useState(false);
  const [durationHours, setDurationHours] = useState<number | null>(null);
  const [emojiFor, setEmojiFor] = useState<{ key: number; anchor: PickerAnchor } | null>(null);
  const optionRefs = useRef(new Map<number, HTMLInputElement>());
  const focusKey = useRef<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !emojiFor) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, emojiFor]);

  // Move the caret into a freshly added row without an autoFocus race.
  useEffect(() => {
    if (focusKey.current === null) return;
    optionRefs.current.get(focusKey.current)?.focus();
    focusKey.current = null;
  });

  function updateOption(key: number, patch: Partial<DraftOption>) {
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  }

  function addOption() {
    if (options.length >= POLL_MAX_OPTIONS) return;
    const created = blankOption();
    focusKey.current = created.key;
    setOptions((prev) => [...prev, created]);
  }

  function removeOption(key: number) {
    if (options.length <= 2) return;
    optionRefs.current.delete(key);
    setOptions((prev) => prev.filter((o) => o.key !== key));
  }

  function onOptionKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const next = options[index + 1];
    if (next) optionRefs.current.get(next.key)?.focus();
    else addOption();
  }

  const filled = options
    .map((o) => ({ text: o.text.trim(), emoji: o.emoji }))
    .filter((o) => o.text.length > 0);
  const canSubmit = question.trim().length > 0 && filled.length >= 2;

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      question: question.trim(),
      options: filled,
      allowMultiple,
      hideVoters,
      closesAt:
        durationHours === null ? null : new Date(Date.now() + durationHours * 3_600_000).toISOString()
    });
  }

  return createPortal(
    <>
      <div className="animate-overlay-in fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Nowa ankieta"
        className="animate-modal-pop glass-strong fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[26rem] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col p-5"
      >
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon icon={BarChart3} size={15} className="text-[var(--accent)]" /> Nowa ankieta
        </h2>

        <div className="-mr-2 mt-3 flex-1 space-y-4 overflow-y-auto pr-2">
          <div className="space-y-1.5">
            <label htmlFor="poll-question" className="text-xs font-medium text-[var(--text-dim)]">
              Pytanie
            </label>
            <input
              id="poll-question"
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="O co pytasz zespół?"
              maxLength={300}
              className="w-full rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]/60"
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-[var(--text-dim)]">
              Odpowiedzi ({options.length}/{POLL_MAX_OPTIONS})
            </span>
            {options.map((opt, i) => (
              <div key={opt.key} className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={`Emoji dla odpowiedzi ${i + 1}`}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setEmojiFor({
                      key: opt.key,
                      anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
                    });
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] text-base hover:border-[var(--accent)]/60"
                >
                  {opt.emoji ?? <Icon icon={Smile} size={15} className="text-[var(--text-dim)]" />}
                </button>
                <input
                  ref={(el) => {
                    if (el) optionRefs.current.set(opt.key, el);
                  }}
                  value={opt.text}
                  onChange={(e) => updateOption(opt.key, { text: e.target.value })}
                  onKeyDown={(e) => onOptionKeyDown(e, i)}
                  placeholder={`Odpowiedź ${i + 1}`}
                  maxLength={120}
                  className="h-9 flex-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-3 text-sm outline-none focus:border-[var(--accent)]/60"
                />
                <button
                  type="button"
                  onClick={() => removeOption(opt.key)}
                  disabled={options.length <= 2}
                  aria-label={`Usuń odpowiedź ${i + 1}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-dim)] hover:bg-[var(--border)]/40 hover:text-[var(--danger)] disabled:pointer-events-none disabled:opacity-30"
                >
                  <Icon icon={X} size={15} />
                </button>
              </div>
            ))}
            {options.length < POLL_MAX_OPTIONS && (
              <button
                type="button"
                onClick={addOption}
                className="flex h-9 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--glass-border)] text-xs text-[var(--text-dim)] hover:border-[var(--accent)]/60 hover:text-[var(--accent)]"
              >
                <Icon icon={Plus} size={14} /> Dodaj odpowiedź
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-[var(--text-dim)]">Czas trwania</span>
            <div className="flex flex-wrap gap-1.5">
              {DURATIONS.map((d) => (
                <button
                  key={d.label}
                  type="button"
                  onClick={() => setDurationHours(d.hours)}
                  aria-pressed={durationHours === d.hours}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    durationHours === d.hours
                      ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                      : "border-[var(--glass-border)] text-[var(--text-dim)] hover:border-[var(--accent)]/50"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-[var(--glass-border)] p-3">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={allowMultiple}
                onChange={(e) => setAllowMultiple(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
              <span>
                Wiele odpowiedzi
                <span className="block text-xs text-[var(--text-dim)]">
                  Każdy może zaznaczyć dowolną liczbę pozycji.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={hideVoters}
                onChange={(e) => setHideVoters(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
              <span>
                <span className="flex items-center gap-1.5">
                  <Icon icon={EyeOff} size={13} className="text-[var(--text-dim)]" /> Ukryj kto jak zagłosował
                </span>
                <span className="block text-xs text-[var(--text-dim)]">
                  Widoczne będą tylko liczby. Tego ustawienia nie da się później cofnąć.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-[var(--text-dim)] hover:bg-[var(--border)]/40"
          >
            Anuluj
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Utwórz ankietę
          </button>
        </div>
      </div>

      {emojiFor && (
        <EmojiPicker
          anchor={emojiFor.anchor}
          onClose={() => setEmojiFor(null)}
          onPick={(emoji) => {
            // Picking the emoji already set clears it, so a row can go back to
            // plain text without a separate reset control.
            const current = options.find((o) => o.key === emojiFor.key)?.emoji;
            updateOption(emojiFor.key, { emoji: current === emoji ? null : emoji });
            setEmojiFor(null);
          }}
        />
      )}
    </>,
    document.body
  );
}
