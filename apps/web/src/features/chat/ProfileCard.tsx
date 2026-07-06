import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../../lib/api.js";
import { Avatar } from "../../components/Avatar.js";

interface MemberProfileDto {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  jobTitle: string | null;
  department: string | null;
  phone: string | null;
  statusText: string | null;
  statusEmoji: string | null;
  avatarUrl: string | null;
}

interface ProfileCardProps {
  orgId: string;
  userId: string;
  anchor: { x: number; y: number };
  onClose: () => void;
}

/**
 * Small popover with a member's profile details, shown near the click
 * point. Rendered through a portal so it always positions against the
 * viewport — the same fix needed for the PDF/image modals, since this can
 * also be triggered from inside the virtualized (transformed) message list.
 */
export function ProfileCard({ orgId, userId, anchor, onClose }: ProfileCardProps) {
  const [profile, setProfile] = useState<MemberProfileDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<MemberProfileDto>(`/orgs/${orgId}/members/${userId}/profile`).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, userId]);

  const style = {
    left: Math.min(anchor.x, window.innerWidth - 280),
    top: Math.min(anchor.y, window.innerHeight - 260)
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="glass-strong animate-modal-pop fixed z-50 w-64 space-y-3 p-4"
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        {!profile ? (
          <p className="text-sm text-[var(--text-dim)]">Ładowanie…</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Avatar userId={profile.userId} displayName={profile.displayName} url={profile.avatarUrl} size={48} />
              <div>
                <p className="font-semibold text-[var(--text)]">{profile.displayName}</p>
                <p className="text-xs text-[var(--text-dim)]">{profile.role}</p>
              </div>
            </div>
            {profile.statusText && (
              <p className="rounded-lg bg-[var(--border)]/40 px-2 py-1 text-sm">
                {profile.statusEmoji} {profile.statusText}
              </p>
            )}
            <dl className="space-y-1 text-sm">
              {profile.jobTitle && (
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--text-dim)]">Stanowisko</dt>
                  <dd>{profile.jobTitle}</dd>
                </div>
              )}
              {profile.department && (
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--text-dim)]">Dział</dt>
                  <dd>{profile.department}</dd>
                </div>
              )}
              {profile.phone && (
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--text-dim)]">Telefon</dt>
                  <dd>{profile.phone}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--text-dim)]">Email</dt>
                <dd className="truncate">{profile.email}</dd>
              </div>
            </dl>
          </>
        )}
      </div>
    </>,
    document.body
  );
}
