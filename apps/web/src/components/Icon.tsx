import type { LucideIcon } from "lucide-react";

interface IconProps {
  icon: LucideIcon;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

/**
 * Thin wrapper around lucide-react icons so chrome-UI icon usage stays
 * consistent (size/stroke) without importing+configuring lucide directly
 * in every component. Emoji are intentionally NOT touched by this — they
 * remain for user-facing content (reactions, custom status, polls).
 */
export function Icon({ icon: LucideIconComponent, size = 16, className = "", strokeWidth = 1.75 }: IconProps) {
  return <LucideIconComponent size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />;
}
