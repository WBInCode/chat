import { createPortal } from "react-dom";

interface OrgMemberLite {
  userId: string;
  displayName: string;
}

interface GroupDmPickerProps {
  members: OrgMemberLite[];
  selection: Set<string>;
  onToggle: (userId: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/** Multi-select picker for starting a group DM with 2+ colleagues. */
export function GroupDmPicker({ members, selection, onToggle, onClose, onSubmit }: GroupDmPickerProps) {
  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-modal-pop glass-strong fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 space-y-3 p-5">
        <h2 className="text-sm font-semibold">Nowa grupa (2+ osoby)</h2>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {members.map((m) => (
            <label
              key={m.userId}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--border)]/30"
            >
              <input
                type="checkbox"
                checked={selection.has(m.userId)}
                onChange={() => onToggle(m.userId)}
                className="accent-[var(--accent)]"
              />
              {m.displayName}
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-[var(--text-dim)] hover:bg-[var(--border)]/40">
            Anuluj
          </button>
          <button
            onClick={onSubmit}
            disabled={selection.size < 2}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Utwórz grupę ({selection.size})
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
