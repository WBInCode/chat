import { useState } from "react";
import { createPortal } from "react-dom";

interface CreatePollModalProps {
  onClose: () => void;
  onSubmit: (question: string, options: string[], allowMultiple: boolean) => void;
}

/** Modal to create a simple poll: question + 2-10 options + single/multi choice. */
export function CreatePollModal({ onClose, onSubmit }: CreatePollModalProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(false);

  function updateOption(i: number, value: string) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  }

  function addOption() {
    if (options.length < 10) setOptions((prev) => [...prev, ""]);
  }

  function removeOption(i: number) {
    if (options.length > 2) setOptions((prev) => prev.filter((_, idx) => idx !== i));
  }

  const validOptions = options.map((o) => o.trim()).filter(Boolean);
  const canSubmit = question.trim().length > 0 && validOptions.length >= 2;

  return createPortal(
    <>
      <div className="animate-overlay-in fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-modal-pop glass-strong fixed left-1/2 top-1/2 z-50 w-96 max-w-[92vw] -translate-x-1/2 -translate-y-1/2 space-y-3 p-5">
        <h2 className="text-sm font-semibold">📊 Nowa ankieta</h2>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Pytanie…"
          maxLength={300}
          className="w-full rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1.5 text-sm outline-none"
        />
        <div className="max-h-52 space-y-1.5 overflow-y-auto">
          {options.map((opt, i) => (
            <div key={i} className="flex gap-1.5">
              <input
                value={opt}
                onChange={(e) => updateOption(i, e.target.value)}
                placeholder={`Opcja ${i + 1}`}
                maxLength={120}
                className="flex-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1.5 text-sm outline-none"
              />
              {options.length > 2 && (
                <button onClick={() => removeOption(i)} className="text-[var(--danger)]">
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        {options.length < 10 && (
          <button onClick={addOption} className="text-xs text-[var(--accent)] hover:underline">
            + Dodaj opcję
          </button>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allowMultiple}
            onChange={(e) => setAllowMultiple(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          Pozwól na wiele odpowiedzi
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-[var(--text-dim)] hover:bg-[var(--border)]/40">
            Anuluj
          </button>
          <button
            onClick={() => onSubmit(question.trim(), validOptions, allowMultiple)}
            disabled={!canSubmit}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Utwórz ankietę
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
