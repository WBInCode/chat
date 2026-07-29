import { CheckSquare, Plus, Square, Trash2 } from "lucide-react";
import { CHECKLIST_MAX_ITEMS, type ChecklistBlockData } from "@chatv2/shared";
import { Icon } from "../../../components/Icon.js";

interface ChecklistBlockProps {
  data: ChecklistBlockData;
  editing: boolean;
  memberName: (userId: string) => string;
  onChange: (data: ChecklistBlockData) => void;
  onToggle: (itemId: string, checked: boolean) => void;
}

function newItemId(): string {
  return crypto.randomUUID();
}

/**
 * Shared task list. Ticking an item is available to every channel member and
 * goes through its own endpoint, so it works while somebody else has the
 * block open for editing and never collides with a reword in progress.
 */
export function ChecklistBlock({ data, editing, memberName, onChange, onToggle }: ChecklistBlockProps) {
  const done = data.items.filter((i) => i.checked).length;

  function setText(id: string, text: string) {
    onChange({ ...data, items: data.items.map((i) => (i.id === id ? { ...i, text } : i)) });
  }

  function addItem() {
    if (data.items.length >= CHECKLIST_MAX_ITEMS) return;
    onChange({
      ...data,
      items: [
        ...data.items,
        { id: newItemId(), text: "", checked: false, checkedById: null, checkedAt: null }
      ]
    });
  }

  function removeItem(id: string) {
    onChange({ ...data, items: data.items.filter((i) => i.id !== id) });
  }

  return (
    <div className="space-y-1">
      {data.items.length > 0 && (
        <p className="text-xs text-[var(--text-dim)]">
          Wykonane {done} z {data.items.length}
        </p>
      )}

      {data.items.map((item) => (
        <div key={item.id} className="flex items-start gap-2 text-sm">
          <button
            onClick={() => onToggle(item.id, !item.checked)}
            aria-pressed={item.checked}
            aria-label={item.checked ? `Odznacz: ${item.text}` : `Odhacz: ${item.text}`}
            className={`mt-0.5 shrink-0 ${item.checked ? "text-[var(--accent-2)]" : "text-[var(--text-dim)] hover:text-[var(--accent)]"}`}
          >
            <Icon icon={item.checked ? CheckSquare : Square} size={16} />
          </button>

          {editing ? (
            <input
              value={item.text}
              onChange={(e) => setText(item.id, e.target.value)}
              placeholder="Zadanie do wykonania"
              maxLength={500}
              className="flex-1 rounded bg-transparent px-1 py-0.5 text-sm outline-none focus:bg-[var(--glass)]"
            />
          ) : (
            // The strikethrough sits on the task text alone. Putting it on the
            // wrapper would drag the attribution through it too, since a
            // descendant cannot cancel an ancestor's text decoration.
            <span className="flex flex-1 flex-wrap items-baseline gap-x-2">
              <span className={item.checked ? "text-[var(--text-dim)] line-through" : ""}>
                {item.text || <span className="text-[var(--text-dim)]">Pusta pozycja</span>}
              </span>
              {item.checked && item.checkedById && (
                <span className="text-xs text-[var(--text-dim)]">{memberName(item.checkedById)}</span>
              )}
            </span>
          )}

          {editing && (
            <button
              onClick={() => removeItem(item.id)}
              aria-label="Usuń pozycję"
              className="mt-0.5 shrink-0 text-[var(--text-dim)] hover:text-[var(--danger)]"
            >
              <Icon icon={Trash2} size={13} />
            </button>
          )}
        </div>
      ))}

      {editing && data.items.length < CHECKLIST_MAX_ITEMS && (
        <button
          onClick={addItem}
          className="flex items-center gap-1 text-xs text-[var(--text-dim)] hover:text-[var(--accent)]"
        >
          <Icon icon={Plus} size={12} /> Dodaj pozycję
        </button>
      )}

      {!editing && data.items.length === 0 && (
        <p className="text-sm text-[var(--text-dim)]">Lista jest pusta.</p>
      )}
    </div>
  );
}
