import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface SidebarSectionProps {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}

const STORAGE_KEY = "chatv2-sidebar-collapsed";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveCollapsed(set: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

/**
 * Collapsible sidebar section (Favorites/Channels/DMs/Team). Reduces visual
 * clutter by letting users hide sections they don't use often; collapse
 * state persists across reloads via localStorage.
 */
export function SidebarSection({ id, title, action, children }: SidebarSectionProps) {
  const [collapsed, setCollapsed] = useState(() => loadCollapsed().has(id));
  const isOpen = !collapsed;

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      const stored = loadCollapsed();
      if (next) stored.add(id);
      else stored.delete(id);
      saveCollapsed(stored);
      return next;
    });
  }

  return (
    <div className="mt-3 first:mt-0">
      <div className="flex items-center justify-between px-2 py-1">
        <button
          onClick={toggle}
          className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-[var(--text-dim)] transition-colors hover:text-[var(--text)]"
        >
          <ChevronDown size={12} strokeWidth={2} className={`transition-transform duration-150 ${isOpen ? "" : "-rotate-90"}`} />
          {title}
        </button>
        {action}
      </div>
      {isOpen && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}
