import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Lock } from "lucide-react";
import type { ChannelCategoryDto } from "@chatv2/shared";
import { normalizeChannelName } from "@chatv2/shared";
import { apiFetch, ApiError } from "../../lib/api.js";
import { MemberPicker, type PickableMember } from "../../components/MemberPicker.js";

interface CreateChannelModalProps {
  orgId: string;
  categories: ChannelCategoryDto[];
  /** Kategoria wybrana kliknięciem "+" przy jej nagłówku. */
  initialCategoryId: string | null;
  orgMembers: PickableMember[];
  currentUserId: string;
  onClose: () => void;
  onCreated: (channelId: string) => void;
}

/** Modal to create a new PUBLIC or PRIVATE channel. */
export function CreateChannelModal({
  orgId,
  categories,
  initialCategoryId,
  orgMembers,
  currentUserId,
  onClose,
  onCreated
}: CreateChannelModalProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [kind, setKind] = useState<"TEXT" | "ANNOUNCEMENT">("TEXT");
  const [categoryId, setCategoryId] = useState<string | null>(initialCategoryId);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const category = categories.find((c) => c.id === categoryId) ?? null;
  const categoryIsPrivate = category?.private ?? false;

  // Kategoria prywatna nie może zawierać kanałów publicznych, więc wybór typu
  // przestaje mieć sens i ustawiamy go za użytkownika.
  useEffect(() => {
    if (categoryIsPrivate) setType("PRIVATE");
  }, [categoryIsPrivate]);

  const normalized = normalizeChannelName(name);
  const inheritedIds = categoryIsPrivate ? (category?.memberIds ?? []) : [];

  async function create() {
    if (normalized.length < 2) return;
    setCreating(true);
    setError(null);
    try {
      const channel = await apiFetch<{ id: string }>(`/orgs/${orgId}/channels`, {
        method: "POST",
        body: JSON.stringify({
          name: normalized,
          type,
          kind,
          categoryId,
          ...(type === "PRIVATE" ? { memberIds } : {})
        })
      });
      onCreated(channel.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się utworzyć kanału");
    } finally {
      setCreating(false);
    }
  }

  return createPortal(
    <>
      <div className="animate-overlay-in fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-modal-pop glass-strong fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[26rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 space-y-3 overflow-y-auto p-5">
        <h2 className="text-sm font-semibold">Utwórz kanał</h2>

        <label className="block space-y-1 text-sm">
          <span className="text-[var(--text-dim)]">Nazwa kanału</span>
          <div className="field-pill flex items-center gap-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2.5 py-2">
            <span className="text-[var(--text-dim)]">#</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="np. marketing"
              maxLength={80}
              className="flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          {name && normalized !== name.trim().toLowerCase() && (
            <p className="text-xs text-[var(--text-dim)]">Zostanie zapisany jako: #{normalized}</p>
          )}
        </label>

        <div className="space-y-1.5">
          <label
            className={`flex items-start gap-2 rounded-lg border border-[var(--glass-border)] p-2.5 text-sm has-[:checked]:border-[var(--accent)] ${
              categoryIsPrivate ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            }`}
          >
            <input
              type="radio"
              checked={type === "PUBLIC"}
              disabled={categoryIsPrivate}
              onChange={() => setType("PUBLIC")}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              <span className="block font-medium"># Publiczny</span>
              <span className="block text-xs text-[var(--text-dim)]">Widoczny i dostępny dla wszystkich w organizacji</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--glass-border)] p-2.5 text-sm has-[:checked]:border-[var(--accent)]">
            <input type="radio" checked={type === "PRIVATE"} onChange={() => setType("PRIVATE")} className="mt-0.5 accent-[var(--accent)]" />
            <span>
              <span className="block font-medium">Prywatny</span>
              <span className="block text-xs text-[var(--text-dim)]">Tylko wybrane osoby. Listę możesz zmienić także później.</span>
            </span>
          </label>
        </div>

        {categoryIsPrivate && (
          <p className="flex items-start gap-1.5 text-xs text-[var(--text-dim)]">
            <Lock size={12} className="mt-0.5 shrink-0" />
            <span>
              Kategoria „{category?.name}” jest prywatna, więc kanał też będzie prywatny. Osoby
              przypisane do kategorii ({inheritedIds.length}) dostaną dostęp automatycznie.
            </span>
          </p>
        )}

        {type === "PRIVATE" && (
          <div className="space-y-1 text-sm">
            <span className="text-[var(--text-dim)]">Kto ma mieć dostęp</span>
            <MemberPicker
              members={orgMembers.filter((m) => !inheritedIds.includes(m.userId))}
              selected={memberIds}
              onChange={setMemberIds}
              lockedIds={[currentUserId]}
              emptyLabel="Wszyscy mają już dostęp"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1 text-sm">
            <span className="text-[var(--text-dim)]">Rodzaj</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "TEXT" | "ANNOUNCEMENT")}
              className="w-full rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2.5 py-2 text-sm outline-none"
            >
              <option value="TEXT">Tekstowy</option>
              <option value="ANNOUNCEMENT">Ogłoszeniowy</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-[var(--text-dim)]">Kategoria</span>
            <select
              value={categoryId ?? ""}
              onChange={(e) => setCategoryId(e.target.value === "" ? null : e.target.value)}
              className="w-full rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2.5 py-2 text-sm outline-none"
            >
              <option value="">Bez kategorii</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.private ? `${c.name} (prywatna)` : c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {kind === "ANNOUNCEMENT" && (
          <p className="text-xs text-[var(--text-dim)]">
            W kanale ogłoszeniowym pisać mogą tylko administratorzy kanału. Pozostali go czytają.
          </p>
        )}

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-[var(--text-dim)] hover:bg-[var(--border)]/40">
            Anuluj
          </button>
          <button
            onClick={create}
            disabled={normalized.length < 2 || creating}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {creating ? "Tworzenie…" : "Utwórz kanał"}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
