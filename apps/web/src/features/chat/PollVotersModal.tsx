import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Users, X } from "lucide-react";
import type { PollDto, PollVotersDto } from "@chatv2/shared";
import { Avatar } from "../../components/Avatar.js";
import { Icon } from "../../components/Icon.js";
import { apiFetch } from "../../lib/api.js";

interface PollVotersModalProps {
  poll: PollDto;
  /** Option to select on open, so clicking an avatar stack lands on that answer. */
  initialOptionId?: string | undefined;
  onClose: () => void;
}

/**
 * Full breakdown of who picked what. Voter lists are fetched here rather than
 * shipped with every poll in the channel history, since a large channel would
 * otherwise attach hundreds of user records to each rendered poll.
 */
export function PollVotersModal({ poll, initialOptionId, onClose }: PollVotersModalProps) {
  const [data, setData] = useState<PollVotersDto | null>(null);
  const [error, setError] = useState(false);
  const [activeId, setActiveId] = useState(initialOptionId ?? poll.options[0]?.id ?? "");

  useEffect(() => {
    let cancelled = false;
    apiFetch<PollVotersDto>(`/polls/${poll.id}/voters`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [poll.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const activeOption = poll.options.find((o) => o.id === activeId);
  const voters = data?.options.find((o) => o.optionId === activeId)?.voters ?? [];

  return createPortal(
    <>
      <div className="animate-overlay-in fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Kto jak zagłosował"
        className="animate-modal-pop glass-strong fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[24rem] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Icon icon={Users} size={15} className="text-[var(--accent)]" /> Kto jak zagłosował
            </h2>
            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-dim)]">{poll.question}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-dim)] hover:bg-[var(--border)]/40"
          >
            <Icon icon={X} size={15} />
          </button>
        </div>

        <div className="-mr-2 mt-3 flex flex-wrap gap-1.5 pr-2">
          {poll.options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setActiveId(opt.id)}
              aria-pressed={opt.id === activeId}
              className={`max-w-full truncate rounded-full border px-3 py-1.5 text-xs transition-colors ${
                opt.id === activeId
                  ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                  : "border-[var(--glass-border)] text-[var(--text-dim)] hover:border-[var(--accent)]/50"
              }`}
            >
              {opt.emoji ? `${opt.emoji} ` : ""}
              {opt.text} · {opt.votes}
            </button>
          ))}
        </div>

        <div className="-mr-2 mt-3 flex-1 overflow-y-auto pr-2">
          {error && <p className="py-6 text-center text-xs text-[var(--danger)]">Nie udało się pobrać listy.</p>}
          {!error && !data && <p className="py-6 text-center text-xs text-[var(--text-dim)]">Wczytywanie…</p>}
          {!error && data && voters.length === 0 && (
            <p className="py-6 text-center text-xs text-[var(--text-dim)]">
              Nikt jeszcze nie wybrał tej odpowiedzi.
            </p>
          )}
          {!error && data && voters.length > 0 && (
            <ul className="space-y-0.5">
              {voters.map((v) => (
                <li key={v.id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
                  <Avatar userId={v.id} displayName={v.displayName} url={v.avatarUrl} size={28} />
                  <span className="truncate text-sm">{v.displayName}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {activeOption && data && (
          <p className="mt-2 border-t border-[var(--glass-border)] pt-2 text-xs text-[var(--text-dim)]">
            {voters.length} z {poll.voterCount} głosujących wybrało tę odpowiedź.
          </p>
        )}
      </div>
    </>,
    document.body
  );
}
