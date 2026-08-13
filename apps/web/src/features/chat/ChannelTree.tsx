import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Hash,
  Lock,
  Megaphone,
  ChevronDown,
  Plus,
  BellOff,
  Settings,
  Star,
  Bell,
  Trash2,
  FolderPlus,
  MoreVertical,
  Archive
} from "lucide-react";
import type { ChannelCategoryDto } from "@chatv2/shared";
import type { ChannelItem } from "../../stores/chat.js";

/**
 * Drzewo kanałów w bocznym pasku: kategorie ze zwijaniem, przeciąganie
 * kanałów między kategoriami i menu kontekstowe pod prawym przyciskiem myszy.
 *
 * Kolejność jest wspólna dla całej organizacji, więc przeciągać mogą wyłącznie
 * osoby z uprawnieniem do zarządzania kanałami. Pozostali widzą listę
 * tylko do odczytu — inaczej ktoś przestawiłby kanały wszystkim naraz.
 */

const COLLAPSED_KEY = "chatv2-collapsed-categories";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveCollapsed(set: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    // Prywatny tryb przeglądarki blokuje zapis — zwijanie po prostu nie przetrwa odświeżenia.
  }
}

/** Klucz pozycji "bez kategorii" — kanały nieprzypisane, na górze listy. */
const UNCATEGORIZED = "__brak__";

export interface ChannelTreeProps {
  channels: ChannelItem[];
  categories: ChannelCategoryDto[];
  activeChannelId: string | null;
  draftChannels: Set<string>;
  canManage: boolean;
  onSelect: (channelId: string) => void;
  onToggleMute: (channelId: string, muted: boolean) => void;
  onToggleFavorite: (channelId: string, favorite: boolean) => void;
  onOpenSettings: (channelId: string) => void;
  onDelete: (channel: ChannelItem) => void;
  onArchive: (channel: ChannelItem) => void;
  onCreateChannel: (categoryId: string | null) => void;
  onCreateCategory: () => void;
  onRenameCategory: (category: ChannelCategoryDto) => void;
  onDeleteCategory: (category: ChannelCategoryDto) => void;
  onLayoutChange: (
    categories: Array<{ id: string; position: number }>,
    channels: Array<{ id: string; categoryId: string | null; position: number }>
  ) => void;
}

type DragPayload =
  | { kind: "channel"; id: string }
  | { kind: "category"; id: string };

interface MenuState {
  x: number;
  y: number;
  target: { kind: "channel"; channel: ChannelItem } | { kind: "category"; category: ChannelCategoryDto };
}

export function ChannelTree({
  channels,
  categories,
  activeChannelId,
  draftChannels,
  canManage,
  onSelect,
  onToggleMute,
  onToggleFavorite,
  onOpenSettings,
  onDelete,
  onArchive,
  onCreateChannel,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
  onLayoutChange
}: ChannelTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Kanały pogrupowane po kategoriach, w kolejności ustalonej przez serwer.
  const grouped = useMemo(() => {
    const visible = channels.filter((c) => c.type !== "DM" && !c.archivedAt);
    const byCategory = new Map<string, ChannelItem[]>();
    byCategory.set(UNCATEGORIZED, []);
    for (const cat of categories) byCategory.set(cat.id, []);
    for (const ch of visible) {
      const key = ch.categoryId && byCategory.has(ch.categoryId) ? ch.categoryId : UNCATEGORIZED;
      byCategory.get(key)!.push(ch);
    }
    for (const list of byCategory.values()) {
      list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    }
    return byCategory;
  }, [channels, categories]);

  function toggleCategory(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(next);
      return next;
    });
  }

  /**
   * Przelicza cały układ po upuszczeniu i oddaje go rodzicowi. Wyliczamy
   * pozycje od zera dla każdej kategorii, dzięki czemu kolejność zostaje
   * spójna nawet po wielu przenosinach i nie robią się dziury w numeracji.
   */
  function commitLayout(nextGrouped: Map<string, ChannelItem[]>, nextCategories: ChannelCategoryDto[]) {
    const channelPayload: Array<{ id: string; categoryId: string | null; position: number }> = [];
    for (const [key, list] of nextGrouped) {
      list.forEach((ch, index) => {
        channelPayload.push({ id: ch.id, categoryId: key === UNCATEGORIZED ? null : key, position: index });
      });
    }
    onLayoutChange(
      nextCategories.map((c, index) => ({ id: c.id, position: index })),
      channelPayload
    );
  }

  function handleDropOnChannel(target: ChannelItem) {
    if (!dragging || !canManage) return;
    if (dragging.kind !== "channel" || dragging.id === target.id) return;

    const next = new Map<string, ChannelItem[]>([...grouped].map(([k, v]) => [k, [...v]]));
    const targetKey = target.categoryId && next.has(target.categoryId) ? target.categoryId : UNCATEGORIZED;

    let moved: ChannelItem | undefined;
    for (const list of next.values()) {
      const idx = list.findIndex((c) => c.id === dragging.id);
      if (idx !== -1) {
        [moved] = list.splice(idx, 1);
        break;
      }
    }
    if (!moved) return;

    const targetList = next.get(targetKey)!;
    const targetIdx = targetList.findIndex((c) => c.id === target.id);
    targetList.splice(targetIdx === -1 ? targetList.length : targetIdx, 0, {
      ...moved,
      categoryId: targetKey === UNCATEGORIZED ? null : targetKey
    });

    commitLayout(next, categories);
  }

  /** Upuszczenie na nagłówek kategorii przenosi kanał na jej koniec. */
  function handleDropOnCategory(categoryKey: string) {
    if (!dragging || !canManage) return;

    if (dragging.kind === "category") {
      if (categoryKey === UNCATEGORIZED || dragging.id === categoryKey) return;
      const next = [...categories];
      const from = next.findIndex((c) => c.id === dragging.id);
      const to = next.findIndex((c) => c.id === categoryKey);
      if (from === -1 || to === -1) return;
      const [movedCat] = next.splice(from, 1);
      next.splice(to, 0, movedCat!);
      commitLayout(grouped, next);
      return;
    }

    const next = new Map<string, ChannelItem[]>([...grouped].map(([k, v]) => [k, [...v]]));
    let moved: ChannelItem | undefined;
    for (const list of next.values()) {
      const idx = list.findIndex((c) => c.id === dragging.id);
      if (idx !== -1) {
        [moved] = list.splice(idx, 1);
        break;
      }
    }
    if (!moved) return;
    next.get(categoryKey)!.push({ ...moved, categoryId: categoryKey === UNCATEGORIZED ? null : categoryKey });
    commitLayout(next, categories);
  }

  function openMenu(e: React.MouseEvent, target: MenuState["target"]) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, target });
  }

  const uncategorized = grouped.get(UNCATEGORIZED) ?? [];

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">Kanały</span>
        {canManage && (
          <div className="flex items-center gap-0.5">
            <button
              onClick={onCreateCategory}
              title="Nowa kategoria"
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-dim)] transition-colors hover:bg-[var(--border)]/40 hover:text-[var(--accent)] touch:h-10 touch:w-10"
            >
              <FolderPlus size={14} />
            </button>
            <button
              onClick={() => onCreateChannel(null)}
              title="Nowy kanał"
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-dim)] transition-colors hover:bg-[var(--border)]/40 hover:text-[var(--accent)] touch:h-10 touch:w-10"
            >
              <Plus size={14} />
            </button>
          </div>
        )}
      </div>

      {uncategorized.length > 0 && (
        <div
          onDragOver={(e) => {
            if (canManage) e.preventDefault();
          }}
          onDrop={() => {
            handleDropOnCategory(UNCATEGORIZED);
            setDragging(null);
            setDropTarget(null);
          }}
          className="space-y-0.5"
        >
          {uncategorized.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              isActive={channel.id === activeChannelId}
              hasDraft={draftChannels.has(channel.id)}
              canManage={canManage}
              isDragging={dragging?.kind === "channel" && dragging.id === channel.id}
              isDropTarget={dropTarget === channel.id}
              onSelect={onSelect}
              onContextMenu={(e) => openMenu(e, { kind: "channel", channel })}
              onDragStart={() => setDragging({ kind: "channel", id: channel.id })}
              onDragEnterRow={() => setDropTarget(channel.id)}
              onDropRow={() => {
                handleDropOnChannel(channel);
                setDragging(null);
                setDropTarget(null);
              }}
              onDragEndRow={() => {
                setDragging(null);
                setDropTarget(null);
              }}
            />
          ))}
        </div>
      )}

      {categories.map((category) => {
        const list = grouped.get(category.id) ?? [];
        const isCollapsed = collapsed.has(category.id);
        // Zwinięta kategoria nadal pokazuje kanały z nieprzeczytanymi
        // wiadomościami oraz ten aktywny — inaczej powiadomienie znika z oczu.
        const shown = isCollapsed
          ? list.filter((c) => c.id === activeChannelId || ((c.unreadCount ?? 0) > 0 && !c.muted))
          : list;

        return (
          <div key={category.id} className="mt-2">
            <div
              draggable={canManage}
              onDragStart={() => canManage && setDragging({ kind: "category", id: category.id })}
              onDragOver={(e) => {
                if (canManage) e.preventDefault();
              }}
              onDragEnter={() => setDropTarget(category.id)}
              onDrop={() => {
                handleDropOnCategory(category.id);
                setDragging(null);
                setDropTarget(null);
              }}
              onDragEnd={() => {
                setDragging(null);
                setDropTarget(null);
              }}
              onContextMenu={(e) => openMenu(e, { kind: "category", category })}
              className={`group flex items-center justify-between rounded px-2 py-1 ${
                dropTarget === category.id && dragging ? "bg-[var(--accent)]/10" : ""
              } ${dragging?.kind === "category" && dragging.id === category.id ? "opacity-40" : ""}`}
            >
              <button
                onClick={() => toggleCategory(category.id)}
                className="flex min-w-0 items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-dim)] transition-colors hover:text-[var(--text)]"
              >
                <ChevronDown
                  size={12}
                  strokeWidth={2.5}
                  className={`shrink-0 transition-transform duration-150 ${isCollapsed ? "-rotate-90" : ""}`}
                />
                {category.private && <Lock size={10} className="shrink-0" />}
                <span className="truncate">{category.name}</span>
              </button>
              {canManage && (
                <div className="flex shrink-0 items-center">
                  <button
                    onClick={() => onCreateChannel(category.id)}
                    title={`Nowy kanał w kategorii ${category.name}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-dim)] opacity-0 transition-opacity hover:bg-[var(--border)]/40 hover:text-[var(--accent)] group-hover:opacity-100 touch:opacity-100"
                  >
                    <Plus size={13} />
                  </button>
                  {/* Widoczny odpowiednik menu spod prawego przycisku myszy.
                      Bez niego zarządzanie kategorią było nie do odnalezienia. */}
                  <button
                    onClick={(e) => openMenu(e, { kind: "category", category })}
                    title={`Zarządzaj kategorią ${category.name}`}
                    aria-label={`Zarządzaj kategorią ${category.name}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-dim)] opacity-0 transition-opacity hover:bg-[var(--border)]/40 hover:text-[var(--text)] group-hover:opacity-100 touch:opacity-100"
                  >
                    <MoreVertical size={13} />
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-0.5">
              {shown.map((channel) => (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  isActive={channel.id === activeChannelId}
                  hasDraft={draftChannels.has(channel.id)}
                  canManage={canManage}
                  isDragging={dragging?.kind === "channel" && dragging.id === channel.id}
                  isDropTarget={dropTarget === channel.id}
                  onSelect={onSelect}
                  onContextMenu={(e) => openMenu(e, { kind: "channel", channel })}
                  onDragStart={() => setDragging({ kind: "channel", id: channel.id })}
                  onDragEnterRow={() => setDropTarget(channel.id)}
                  onDropRow={() => {
                    handleDropOnChannel(channel);
                    setDragging(null);
                    setDropTarget(null);
                  }}
                  onDragEndRow={() => {
                    setDragging(null);
                    setDropTarget(null);
                  }}
                />
              ))}
              {!isCollapsed && list.length === 0 && (
                <p className="px-4 py-1 text-xs italic text-[var(--text-dim)]">Brak kanałów</p>
              )}
            </div>
          </div>
        );
      })}

      {menu && (
        <ContextMenu
          state={menu}
          canManage={canManage}
          onClose={() => setMenu(null)}
          onToggleMute={onToggleMute}
          onToggleFavorite={onToggleFavorite}
          onOpenSettings={onOpenSettings}
          onDelete={onDelete}
          onArchive={onArchive}
          onCreateChannel={onCreateChannel}
          onRenameCategory={onRenameCategory}
          onDeleteCategory={onDeleteCategory}
        />
      )}
    </div>
  );
}

interface ChannelRowProps {
  channel: ChannelItem;
  isActive: boolean;
  hasDraft: boolean;
  canManage: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: () => void;
  onDragEnterRow: () => void;
  onDropRow: () => void;
  onDragEndRow: () => void;
}

function ChannelRow({
  channel,
  isActive,
  hasDraft,
  canManage,
  isDragging,
  isDropTarget,
  onSelect,
  onContextMenu,
  onDragStart,
  onDragEnterRow,
  onDropRow,
  onDragEndRow
}: ChannelRowProps) {
  const icon =
    channel.kind === "ANNOUNCEMENT" ? Megaphone : channel.type === "PRIVATE" ? Lock : Hash;
  const Icon = icon;
  const unread = channel.unreadCount ?? 0;

  return (
    <button
      draggable={canManage}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        if (canManage) e.preventDefault();
      }}
      onDragEnter={onDragEnterRow}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDropRow();
      }}
      onDragEnd={onDragEndRow}
      onClick={() => onSelect(channel.id)}
      onContextMenu={onContextMenu}
      title={channel.topic ?? undefined}
      data-aktywny={isActive ? "tak" : undefined}
      className={`nav-item flex w-full items-center justify-between rounded-lg px-2 py-1.5 pl-4 text-left text-sm transition-all duration-150 ${
        canManage ? "cursor-grab active:cursor-grabbing" : ""
      } ${isDragging ? "opacity-40" : ""} ${
        isDropTarget ? "shadow-[inset_0_2px_0_0_var(--accent)]" : ""
      } ${
        isActive
          ? "bg-[var(--accent)]/15 text-[var(--accent)] shadow-[inset_0_0_0_1px_var(--accent-ring)]"
          : channel.muted
            ? "text-[var(--text-dim)] hover:bg-[var(--border)]/50"
            : unread > 0
              ? "font-medium text-[var(--text)] hover:bg-[var(--border)]/50"
              : "text-[var(--text)] hover:bg-[var(--border)]/50"
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon size={13} className="shrink-0 text-[var(--text-dim)]" />
        <span className="truncate">{channel.name}</span>
        {channel.muted && <BellOff size={12} className="shrink-0" />}
        {hasDraft && <span className="shrink-0 text-[10px] italic text-[var(--text-dim)]">(szkic)</span>}
      </span>
      {unread > 0 && !channel.muted && (
        <span className="animate-spring-in btn-gradient ml-2 min-w-5 rounded-full px-1.5 text-center text-xs font-semibold text-white shadow-[0_2px_8px_var(--accent-glow)]">
          {unread}
        </span>
      )}
    </button>
  );
}

interface ContextMenuProps {
  state: MenuState;
  canManage: boolean;
  onClose: () => void;
  onToggleMute: (channelId: string, muted: boolean) => void;
  onToggleFavorite: (channelId: string, favorite: boolean) => void;
  onOpenSettings: (channelId: string) => void;
  onDelete: (channel: ChannelItem) => void;
  onArchive: (channel: ChannelItem) => void;
  onCreateChannel: (categoryId: string | null) => void;
  onRenameCategory: (category: ChannelCategoryDto) => void;
  onDeleteCategory: (category: ChannelCategoryDto) => void;
}

function ContextMenu({
  state,
  canManage,
  onClose,
  onToggleMute,
  onToggleFavorite,
  onOpenSettings,
  onDelete,
  onArchive,
  onCreateChannel,
  onRenameCategory,
  onDeleteCategory
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: state.x, y: state.y });

  // Menu otwarte przy dolnej lub prawej krawędzi musi wjechać z powrotem
  // w widok, inaczej część pozycji jest nieklikalna.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(state.x, window.innerWidth - rect.width - 8);
    const y = Math.min(state.y, window.innerHeight - rect.height - 8);
    setPosition({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [state.x, state.y]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function item(
    label: string,
    icon: React.ReactNode,
    action: () => void,
    variant: "normal" | "danger" = "normal"
  ) {
    return (
      <button
        onClick={() => {
          action();
          onClose();
        }}
        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
          variant === "danger"
            ? "text-red-400 hover:bg-red-500/10"
            : "text-[var(--text)] hover:bg-[var(--border)]/60"
        }`}
      >
        {icon}
        {label}
      </button>
    );
  }

  const channel = state.target.kind === "channel" ? state.target.channel : null;
  const category = state.target.kind === "category" ? state.target.category : null;

  return createPortal(
    <div
      ref={ref}
      style={{ left: position.x, top: position.y }}
      className="fixed z-[100] min-w-52 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl"
    >
      {channel && (
        <>
          {item(
            channel.muted ? "Wyłącz wyciszenie" : "Wycisz kanał",
            channel.muted ? <Bell size={14} /> : <BellOff size={14} />,
            () => onToggleMute(channel.id, !channel.muted)
          )}
          {item(
            channel.favorite ? "Usuń z ulubionych" : "Dodaj do ulubionych",
            <Star size={14} className={channel.favorite ? "fill-current" : ""} />,
            () => onToggleFavorite(channel.id, !channel.favorite)
          )}
          {(channel.myRole === "ADMIN" || canManage) && (
            <>
              <div className="my-1 h-px bg-[var(--border)]" />
              {item("Ustawienia kanału", <Settings size={14} />, () => onOpenSettings(channel.id))}
              {item("Archiwizuj kanał", <Archive size={14} />, () => onArchive(channel))}
            </>
          )}
          {canManage && (
            <>
              <div className="my-1 h-px bg-[var(--border)]" />
              {item("Usuń kanał", <Trash2 size={14} />, () => onDelete(channel), "danger")}
            </>
          )}
        </>
      )}

      {category && canManage && (
        <>
          {item("Ustawienia kategorii", <Settings size={14} />, () => onRenameCategory(category))}
          {item("Nowy kanał w kategorii", <Plus size={14} />, () => onCreateChannel(category.id))}
          <div className="my-1 h-px bg-[var(--border)]" />
          {item("Usuń kategorię", <Trash2 size={14} />, () => onDeleteCategory(category), "danger")}
        </>
      )}

      {category && !canManage && (
        <p className="px-2 py-1.5 text-xs text-[var(--text-dim)]">Brak dostępnych działań</p>
      )}
    </div>,
    document.body
  );
}
