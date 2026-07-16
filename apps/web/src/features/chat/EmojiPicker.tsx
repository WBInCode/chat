import { useMemo, useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Lightweight, dependency-free emoji picker. Provides a categorized grid and
 * keyword search over a curated (but large) emoji set. Kept native to avoid
 * pulling a heavy emoji dataset / React-19 peer-dependency concerns from
 * third-party pickers.
 *
 * Positioning: when an `anchor` rect is provided the panel renders through a
 * portal with `position: fixed`, clamped to the viewport (never clipped by
 * overflow containers, sidebars or stacking contexts). Without an anchor it
 * falls back to legacy absolute positioning inside the caller.
 */

export interface PickerAnchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

type Category = { id: string; label: string; icon: string; emojis: string[] };

const CATEGORIES: Category[] = [
  {
    id: "smileys",
    label: "Buźki",
    icon: "😀",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊",
      "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "😋", "😛", "😜", "🤪",
      "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐", "😑", "😶", "😏",
      "😒", "🙄", "😬", "🤥", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕",
      "🤢", "🤮", "🤧", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "😎", "🤓",
      "🧐", "😕", "😟", "🙁", "😮", "😯", "😲", "😳", "🥺", "😦", "😧", "😨",
      "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓", "😩", "😫", "🥱",
      "😤", "😡", "😠", "🤬", "😈", "👿", "💀", "💩", "🤡", "👻", "👽", "🤖"
    ]
  },
  {
    id: "gestures",
    label: "Gesty",
    icon: "👍",
    emojis: [
      "👍", "👎", "👌", "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈",
      "👉", "👆", "👇", "☝️", "👋", "🤚", "🖐️", "✋", "🖖", "👏", "🙌", "🫶",
      "🤲", "🙏", "✍️", "💅", "🤳", "💪", "🦾", "👊", "🤛", "🤜", "✊", "🫡"
    ]
  },
  {
    id: "hearts",
    label: "Serca",
    icon: "❤️",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕",
      "💞", "💓", "💗", "💖", "💘", "💝", "💟", "❤️‍🔥", "❤️‍🩹", "💯", "💢", "💥"
    ]
  },
  {
    id: "celebration",
    label: "Świętowanie",
    icon: "🎉",
    emojis: [
      "🎉", "🎊", "🎈", "🎁", "🎀", "🥳", "🍾", "🥂", "🍻", "🎆", "🎇", "✨",
      "🌟", "⭐", "💫", "🔥", "🚀", "🏆", "🥇", "🥈", "🥉", "🎯", "✅", "☑️"
    ]
  },
  {
    id: "objects",
    label: "Praca",
    icon: "💻",
    emojis: [
      "💻", "🖥️", "⌨️", "🖱️", "📱", "☎️", "📞", "📟", "📠", "🖨️", "💾", "💿",
      "📀", "🗂️", "📁", "📂", "📅", "📆", "📊", "📈", "📉", "📋", "📌", "📍",
      "📎", "🖇️", "📏", "📐", "✂️", "🗒️", "📝", "✏️", "🖊️", "🖋️", "📚", "📖",
      "💡", "🔒", "🔓", "🔑", "🔔", "🔕", "⏰", "⏳", "⌛", "☕", "🍵", "🧠"
    ]
  },
  {
    id: "symbols",
    label: "Symbole",
    icon: "⚡",
    emojis: [
      "⚡", "❗", "❓", "‼️", "⁉️", "⚠️", "🚫", "❌", "⭕", "🔴", "🟠", "🟡",
      "🟢", "🔵", "🟣", "⚫", "⚪", "🟤", "♻️", "✔️", "➕", "➖", "➗", "✖️",
      "🆗", "🆕", "🆒", "🔝", "🔜", "©️", "®️", "™️", "💤", "🎵", "🎶", "👀"
    ]
  }
];

// Simple keyword hints for search (only a subset needs explicit keywords; the
// rest are matched by their category label).
const KEYWORDS: Record<string, string> = {
  "😂": "smiech lol haha placz",
  "🤣": "smiech lol rofl",
  "😍": "milosc zakochany serce",
  "👍": "tak ok dobra kciuk up like",
  "👎": "nie zle kciuk down dislike",
  "🙏": "prosze dzieki modlitwa",
  "🔥": "ogien fire hot",
  "🚀": "rakieta start launch",
  "🎉": "impreza party sukces",
  "✅": "gotowe done ok check",
  "❌": "nie blad error",
  "💯": "sto procent full",
  "😢": "smutek placz",
  "😡": "zlosc gniew wsciekly",
  "❤️": "serce milosc love",
  "👀": "patrze oczy widze",
  "💻": "praca kod laptop komputer",
  "☕": "kawa przerwa",
  "🧠": "mozg myslenie",
  "💡": "pomysl idea"
};

export function EmojiPicker({
  onPick,
  onClose,
  anchor
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  anchor?: PickerAnchor | null;
}) {
  const [active, setActive] = useState(CATEGORIES[0]!.id);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);

  // Viewport-aware placement: prefer above the anchor (right-aligned), flip
  // below when there's no room, always clamp inside the viewport.
  useLayoutEffect(() => {
    if (!anchor) return;
    const el = rootRef.current;
    if (!el) return;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(anchor.right - w, margin), Math.max(vw - w - margin, margin));
    let top = anchor.top - h - margin;
    let originY = "bottom";
    if (top < margin) {
      top = Math.min(anchor.bottom + margin, Math.max(vh - h - margin, margin));
      originY = "top";
    }
    const originX = left + w / 2 < anchor.right ? "right" : "left";
    setPos({ left, top, origin: `${originX} ${originY}` });
  }, [anchor]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const cat of CATEGORIES) {
      const catMatch = cat.label.toLowerCase().includes(q);
      for (const e of cat.emojis) {
        if (seen.has(e)) continue;
        if (catMatch || (KEYWORDS[e]?.includes(q) ?? false)) {
          out.push(e);
          seen.add(e);
        }
      }
    }
    return out;
  }, [query]);

  const activeCat = CATEGORIES.find((c) => c.id === active) ?? CATEGORIES[0]!;
  const shown = results ?? activeCat.emojis;

  const floating = !!anchor;
  const panel = (
    <div
      ref={rootRef}
      style={
        floating
          ? {
              position: "fixed",
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              transformOrigin: pos?.origin ?? "center",
              visibility: pos ? "visible" : "hidden"
            }
          : undefined
      }
      className={`${pos || !floating ? "animate-menu-pop" : ""} w-64 overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-strong)] shadow-2xl backdrop-blur-lg ${
        floating ? "z-[80]" : "absolute -top-2 right-0 z-30 -translate-y-full"
      }`}
    >
      <div className="border-b border-[var(--glass-border)] p-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Szukaj emoji…"
          className="w-full rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>
      {!results && (
        <div className="flex items-center justify-between gap-0.5 border-b border-[var(--glass-border)] px-1.5 py-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActive(cat.id)}
              title={cat.label}
              className={`rounded-lg px-1.5 py-1 text-base transition-transform hover:scale-110 ${
                cat.id === active ? "bg-[var(--accent)]/20" : ""
              }`}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}
      <div className="max-h-48 overflow-y-auto p-1.5">
        {shown.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-[var(--text-dim)]">Brak wyników</p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {shown.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onPick(emoji)}
                className="rounded-lg py-1 text-lg leading-none transition-transform hover:scale-125"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return floating ? createPortal(panel, document.body) : panel;
}
