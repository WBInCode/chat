import { useState } from "react";
import { createPortal } from "react-dom";

interface SchedulePickerProps {
  onClose: () => void;
  onSubmit: (sendAtIso: string) => void;
}

/**
 * `<input type="datetime-local">` displays and parses its value as LOCAL
 * wall-clock time with NO timezone info — it is neither UTC nor ISO. Using
 * `toISOString()` (which is always UTC) to build the default value silently
 * shifts it by the local UTC offset every time (e.g. UTC+2 makes a "+1h"
 * default actually display ~1h-2h off from intended). Format manually from
 * local date parts instead.
 */
function toLocalDatetimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Small modal to pick a future date/time for "send later". */
export function SchedulePicker({ onClose, onSubmit }: SchedulePickerProps) {
  const defaultValue = toLocalDatetimeValue(new Date(Date.now() + 60 * 60 * 1000));
  const [value, setValue] = useState(defaultValue);

  function submit() {
    // `new Date("YYYY-MM-DDTHH:mm")` (no timezone suffix) correctly parses
    // as local time in JS, matching what the input displayed — safe here.
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return;
    onSubmit(date.toISOString());
  }

  return createPortal(
    <>
      <div className="animate-overlay-in fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-modal-pop glass-strong fixed left-1/2 top-1/2 z-50 w-80 max-w-[92vw] -translate-x-1/2 -translate-y-1/2 space-y-3 p-5">
        <h2 className="text-sm font-semibold">🕐 Wyślij później</h2>
        <input
          type="datetime-local"
          value={value}
          min={toLocalDatetimeValue(new Date(Date.now() + 60_000))}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1.5 text-sm outline-none"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-[var(--text-dim)] hover:bg-[var(--border)]/40">
            Anuluj
          </button>
          <button
            onClick={submit}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Zaplanuj
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
