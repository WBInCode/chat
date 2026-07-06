const PALETTE = [
  "#5b7cff",
  "#22c55e",
  "#f59e0b",
  "#e5484d",
  "#a855f7",
  "#06b6d4",
  "#ec4899",
  "#84cc16"
];

/** Deterministic color from a user id, so the same person always gets the same fallback color. */
function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

interface AvatarProps {
  userId: string;
  displayName: string;
  url?: string | null | undefined;
  size?: number;
  className?: string;
}

/** Shows the user's photo if available, otherwise a colored initials badge. */
export function Avatar({ userId, displayName, url, size = 32, className = "" }: AvatarProps) {
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) };

  if (url) {
    return (
      <img
        src={url}
        alt={displayName}
        style={style}
        className={`rounded-full object-cover ring-1 ring-[var(--glass-border)] ${className}`}
      />
    );
  }

  return (
    <div
      style={{ ...style, backgroundColor: colorForId(userId) }}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
    >
      {initials(displayName)}
    </div>
  );
}
