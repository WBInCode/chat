import { createPortal } from "react-dom";

interface ReminderPickerProps {
  onClose: () => void;
  onSubmit: (remindAtIso: string) => void;
}

const PRESETS = [
  { label: "Za godzinę", ms: 60 * 60 * 1000 },
  { label: "Jutro rano (9:00)", tomorrow9am: true },
  { label: "Za 3 dni", ms: 3 * 24 * 60 * 60 * 1000 },
  { label: "Za tydzień", ms: 7 * 24 * 60 * 60 * 1000 }
];

/** Quick presets for "remind me about this" — fires a push notification when due. */
export function ReminderPicker({ onClose, onSubmit }: ReminderPickerProps) {
  function pick(preset: (typeof PRESETS)[number]) {
    if (preset.tomorrow9am) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      onSubmit(d.toISOString());
    } else {
      onSubmit(new Date(Date.now() + preset.ms!).toISOString());
    }
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-modal-pop glass-strong fixed left-1/2 top-1/2 z-50 w-64 -translate-x-1/2 -translate-y-1/2 space-y-1.5 p-4">
        <h2 className="mb-1 text-sm font-semibold">⏰ Przypomnij mi</h2>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => pick(p)}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--border)]/40"
          >
            {p.label}
          </button>
        ))}
        <button onClick={onClose} className="mt-1 block w-full rounded-lg px-3 py-1.5 text-center text-xs text-[var(--text-dim)] hover:bg-[var(--border)]/30">
          Anuluj
        </button>
      </div>
    </>,
    document.body
  );
}
