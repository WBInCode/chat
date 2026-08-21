import { useState } from "react";
import { createPortal } from "react-dom";
import { Lock, Globe } from "lucide-react";
import type { ChannelCategoryDto } from "@chatv2/shared";
import { apiFetch, ApiError } from "../../lib/api.js";
import { MemberPicker, type PickableMember } from "../../components/MemberPicker.js";
import { useOknoModalne } from "../../components/oknoModalne.js";

interface Props {
  orgId: string;
  /** null = tworzenie nowej kategorii. */
  category: ChannelCategoryDto | null;
  orgMembers: PickableMember[];
  currentUserId: string;
  onClose: () => void;
  onSaved: (category: ChannelCategoryDto) => void;
}

/**
 * Tworzenie i edycja kategorii. Wcześniej kategoria miała tylko okienko na
 * nazwę, przez co po utworzeniu nie było czym nią zarządzać.
 */
export function CategorySettingsModal({
  orgId,
  category,
  orgMembers,
  currentUserId,
  onClose,
  onSaved
}: Props) {
  const isNew = category === null;
  const [name, setName] = useState(category?.name ?? "");
  const [isPrivate, setIsPrivate] = useState(category?.private ?? false);
  const [memberIds, setMemberIds] = useState<string[]>(
    (category?.memberIds ?? []).filter((id) => id !== currentUserId)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useOknoModalne(onClose);

  const trimmed = name.trim();
  const dirty =
    isNew ||
    trimmed !== category.name ||
    isPrivate !== category.private ||
    memberIds.slice().sort().join() !==
      (category.memberIds ?? []).filter((id) => id !== currentUserId).sort().join();

  async function save() {
    if (trimmed.length < 1) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { name: trimmed, private: isPrivate, memberIds: isPrivate ? memberIds : [] };
      const saved = isNew
        ? await apiFetch<ChannelCategoryDto>(`/orgs/${orgId}/categories`, {
            method: "POST",
            body: JSON.stringify(payload)
          })
        : await apiFetch<ChannelCategoryDto>(`/categories/${category.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
          });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się zapisać kategorii");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <>
      <div className="animate-overlay-in fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "Nowa kategoria" : "Ustawienia kategorii"}
        className="animate-modal-pop glass-strong fixed left-1/2 top-1/2 z-50 max-h-[88dvh] w-[26rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 space-y-3 overflow-y-auto p-5"
      >
        <h2 className="text-sm font-semibold">{isNew ? "Nowa kategoria" : "Ustawienia kategorii"}</h2>

        <label className="block space-y-1 text-sm">
          <span className="text-[var(--text-dim)]">Nazwa</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="np. Projekty"
            maxLength={60}
            className="field-pill w-full rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2.5 py-2 text-sm outline-none"
          />
        </label>

        <div className="space-y-1.5">
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--glass-border)] p-2.5 text-sm has-[:checked]:border-[var(--accent)]">
            <input type="radio" checked={!isPrivate} onChange={() => setIsPrivate(false)} className="mt-0.5 accent-[var(--accent)]" />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-medium">
                <Globe size={13} /> Publiczna
              </span>
              <span className="block text-xs text-[var(--text-dim)]">Nagłówek widoczny dla całej organizacji</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--glass-border)] p-2.5 text-sm has-[:checked]:border-[var(--accent)]">
            <input type="radio" checked={isPrivate} onChange={() => setIsPrivate(true)} className="mt-0.5 accent-[var(--accent)]" />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-medium">
                <Lock size={13} /> Prywatna
              </span>
              <span className="block text-xs text-[var(--text-dim)]">
                Widoczna tylko dla wybranych osób i administratorów organizacji
              </span>
            </span>
          </label>
        </div>

        {isPrivate && (
          <>
            <div className="space-y-1 text-sm">
              <span className="text-[var(--text-dim)]">Kto widzi tę kategorię</span>
              <MemberPicker
                members={orgMembers}
                selected={memberIds}
                onChange={setMemberIds}
                lockedIds={[currentUserId]}
              />
            </div>
            <p className="text-xs text-[var(--text-dim)]">
              Kanały w kategorii prywatnej muszą być prywatne. Nowe kanały tworzone w środku
              dostaną te osoby automatycznie.
            </p>
          </>
        )}

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-[var(--text-dim)] hover:bg-[var(--border)]/40">
            Anuluj
          </button>
          <button
            onClick={save}
            disabled={trimmed.length < 1 || saving || !dirty}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Zapisywanie..." : isNew ? "Utwórz" : "Zapisz"}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
