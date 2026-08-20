import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Hash, Megaphone, Timer, FolderTree, Trash2, AlertTriangle } from "lucide-react";
import type { ChannelCategoryDto } from "@chatv2/shared";
import { SLOWMODE_OPTIONS, normalizeChannelName } from "@chatv2/shared";
import type { ChannelItem } from "../../stores/chat.js";
import { apiFetch, ApiError } from "../../lib/api.js";
import { ConfirmDialog } from "../../components/Dialog.js";
import { useOknoModalne } from "../../components/oknoModalne.js";

/**
 * Ustawienia kanału w układzie zakładek, wzorowane na Discordzie.
 * Zakładka "Przegląd" zbiera nazwę, temat, rodzaj kanału, tryb wolny
 * i przypisanie do kategorii; wysyłamy wyłącznie pola, które zmieniono.
 */

interface Props {
  channel: ChannelItem;
  categories: ChannelCategoryDto[];
  canManage: boolean;
  initialTab?: Tab;
  onClose: () => void;
  onSaved: (patch: Partial<ChannelItem>) => void;
  onDeleted: (channelId: string) => void;
  membersSlot?: React.ReactNode;
  permissionsSlot?: React.ReactNode;
}

type Tab = "overview" | "members" | "permissions";

function slowmodeLabel(seconds: number) {
  if (seconds === 0) return "Wyłączony";
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${seconds / 60} min`;
  return `${seconds / 3600} godz.`;
}

export function ChannelSettingsModal({
  channel,
  categories,
  canManage,
  initialTab = "overview",
  onClose,
  onSaved,
  onDeleted,
  membersSlot,
  permissionsSlot
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [name, setName] = useState(channel.name ?? "");
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [kind, setKind] = useState<"TEXT" | "ANNOUNCEMENT">(channel.kind ?? "TEXT");
  const [slowmode, setSlowmode] = useState(channel.slowmodeSeconds ?? 0);
  const [categoryId, setCategoryId] = useState<string | null>(channel.categoryId ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const panelRef = useOknoModalne(onClose);

  const normalizedName = normalizeChannelName(name);
  const dirty =
    normalizedName !== (channel.name ?? "") ||
    topic !== (channel.topic ?? "") ||
    kind !== (channel.kind ?? "TEXT") ||
    slowmode !== (channel.slowmodeSeconds ?? 0) ||
    categoryId !== (channel.categoryId ?? null);

  async function save() {
    setError(null);
    if (normalizedName.length < 2) {
      setError("Nazwa musi mieć co najmniej 2 znaki.");
      return;
    }
    setSaving(true);
    // Wysyłamy tylko realnie zmienione pola — dzięki temu zapis nie nadpisuje
    // ustawień zmienionych w międzyczasie przez kogoś innego.
    const payload: Record<string, unknown> = {};
    if (normalizedName !== (channel.name ?? "")) payload.name = normalizedName;
    if (topic !== (channel.topic ?? "")) payload.topic = topic.trim() === "" ? null : topic.trim();
    if (kind !== (channel.kind ?? "TEXT")) payload.kind = kind;
    if (slowmode !== (channel.slowmodeSeconds ?? 0)) payload.slowmodeSeconds = slowmode;
    if (categoryId !== (channel.categoryId ?? null)) payload.categoryId = categoryId;

    try {
      await apiFetch(`/channels/${channel.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      onSaved({
        name: normalizedName,
        topic: topic.trim() === "" ? null : topic.trim(),
        kind,
        slowmodeSeconds: slowmode,
        categoryId
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się zapisać ustawień.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    await apiFetch(`/channels/${channel.id}`, { method: "DELETE" });
    onDeleted(channel.id);
  }

  const isDm = channel.type === "DM";
  const tabs: Array<{ id: Tab; label: string; visible: boolean }> = [
    // Rozmowa prywatna nie ma nazwy, kategorii ani trybu wolnego — zostańmy
    // przy samej liście uczestników, zamiast pokazywać pola bez zastosowania.
    { id: "overview", label: "Przegląd", visible: !isDm },
    { id: "members", label: "Członkowie", visible: !!membersSlot },
    { id: "permissions", label: "Uprawnienia", visible: !!permissionsSlot }
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Ustawienia kanału ${channel.name ?? ""}`}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(90dvh,44rem)] w-full max-w-3xl overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
      >
        <nav className="w-52 shrink-0 border-r border-[var(--border)] bg-[var(--bg)]/40 p-3">
          <p className="truncate px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-dim)]">
            {channel.name}
          </p>
          {tabs
            .filter((t) => t.visible)
            .map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`mb-0.5 w-full rounded px-2 py-1.5 text-left text-sm transition-colors ${
                  tab === t.id
                    ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                    : "text-[var(--text-dim)] hover:bg-[var(--border)]/40 hover:text-[var(--text)]"
                }`}
              >
                {t.label}
              </button>
            ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
            <h2 className="text-base font-semibold text-[var(--text)]">
              {tabs.find((t) => t.id === tab)?.label}
            </h2>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded text-[var(--text-dim)] transition-colors hover:bg-[var(--border)]/40 hover:text-[var(--text)]"
            >
              <X size={18} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {tab === "overview" && (
              <div className="space-y-5">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">
                    Nazwa kanału
                  </label>
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3">
                    <Hash size={14} className="shrink-0 text-[var(--text-dim)]" />
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-transparent py-2 text-sm text-[var(--text)] outline-none"
                    />
                  </div>
                  {normalizedName !== name && (
                    <p className="mt-1 text-xs text-[var(--text-dim)]">Zostanie zapisane jako: {normalizedName}</p>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">
                    Temat
                  </label>
                  <textarea
                    value={topic}
                    onChange={(e) => setTopic(e.target.value.slice(0, 250))}
                    rows={2}
                    placeholder="Czym zajmuje się ten kanał?"
                    className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent)]"
                  />
                  <p className="mt-1 text-right text-xs text-[var(--text-dim)]">{topic.length}/250</p>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">
                    Rodzaj kanału
                  </label>
                  <div className="space-y-2">
                    <KindOption
                      selected={kind === "TEXT"}
                      onSelect={() => setKind("TEXT")}
                      icon={<Hash size={16} />}
                      title="Tekstowy"
                      description="Pisać mogą wszyscy członkowie kanału."
                    />
                    <KindOption
                      selected={kind === "ANNOUNCEMENT"}
                      onSelect={() => setKind("ANNOUNCEMENT")}
                      icon={<Megaphone size={16} />}
                      title="Ogłoszeniowy"
                      description="Czytają wszyscy, piszą wyłącznie administratorzy kanału."
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">
                    <Timer size={13} /> Tryb wolny
                  </label>
                  <select
                    value={slowmode}
                    onChange={(e) => setSlowmode(Number(e.target.value))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  >
                    {SLOWMODE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {slowmodeLabel(s)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-[var(--text-dim)]">
                    Minimalny odstęp między wiadomościami jednej osoby. Administratorów kanału nie dotyczy.
                  </p>
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">
                    <FolderTree size={13} /> Kategoria
                  </label>
                  <select
                    value={categoryId ?? ""}
                    onChange={(e) => setCategoryId(e.target.value === "" ? null : e.target.value)}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  >
                    <option value="">Bez kategorii</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {canManage && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-red-400">
                      <AlertTriangle size={15} /> Usunięcie kanału
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-dim)]">
                      Kanał zniknie razem z całą historią wiadomości i załącznikami. Tej operacji nie da się
                      cofnąć.
                    </p>
                    <button
                      onClick={() => setConfirmingDelete(true)}
                      className="mt-3 flex min-h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-500 touch:min-h-11"
                    >
                      <Trash2 size={14} />
                      Usuń kanał
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === "members" && membersSlot}
            {tab === "permissions" && permissionsSlot}
          </div>

          {tab === "overview" && (
            <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
              <span className="text-xs text-red-400">{error}</span>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="rounded-lg px-3 py-1.5 text-sm text-[var(--text-dim)] transition-colors hover:text-[var(--text)]"
                >
                  Anuluj
                </button>
                <button
                  onClick={save}
                  disabled={!dirty || saving}
                  className="btn-gradient rounded-lg px-4 py-1.5 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? "Zapisywanie..." : "Zapisz zmiany"}
                </button>
              </div>
            </footer>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title={`Usunąć kanał #${channel.name}?`}
          message="Kanał zniknie razem z całą historią wiadomości i załącznikami. Tej operacji nie da się cofnąć."
          confirmLabel="Usuń kanał"
          danger
          requirePhrase={channel.name ?? ""}
          onConfirm={remove}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>,
    document.body
  );
}

function KindOption({
  selected,
  onSelect,
  icon,
  title,
  description
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent)]/10"
          : "border-[var(--border)] hover:border-[var(--text-dim)]"
      }`}
    >
      <span className={`mt-0.5 shrink-0 ${selected ? "text-[var(--accent)]" : "text-[var(--text-dim)]"}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--text)]">{title}</span>
        <span className="block text-xs text-[var(--text-dim)]">{description}</span>
      </span>
    </button>
  );
}
