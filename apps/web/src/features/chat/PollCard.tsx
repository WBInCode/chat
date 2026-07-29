import { useCallback, useEffect, useState } from "react";
import { BarChart3, Check, EyeOff, Lock, Users } from "lucide-react";
import type { PollDto } from "@chatv2/shared";
import { Avatar } from "../../components/Avatar.js";
import { Icon } from "../../components/Icon.js";
import { apiFetch } from "../../lib/api.js";
import { getSocket } from "../../lib/socket.js";
import { PollVotersModal } from "./PollVotersModal.js";

/** "za 3 dni", "za 2 godz.", "za 14 min" — coarse on purpose, no ticking seconds. */
function formatRemaining(closesAt: string): string {
  const ms = new Date(closesAt).getTime() - Date.now();
  if (ms <= 0) return "kończy się";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `za ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `za ${hours} godz.`;
  const days = Math.round(hours / 24);
  return `za ${days} ${days === 1 ? "dzień" : "dni"}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const lastTwo = n % 100;
  const last = n % 10;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

/**
 * Renders a poll attached to a message: answers with live result bars, an
 * avatar stack of who picked what, and controls to end the poll early.
 *
 * Refetches on `poll:update` rather than trusting the broadcast payload: its
 * `votedByMe` and `canClose` are resolved for whoever triggered the event,
 * not for the person reading it, so applying it blindly would show one user's
 * state to everyone in the channel.
 */
export function PollCard({ messageId }: { messageId: string }) {
  const [poll, setPoll] = useState<PollDto | null>(null);
  const [votersFor, setVotersFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    void apiFetch<PollDto>(`/messages/${messageId}/poll`)
      .then(setPoll)
      .catch(() => setPoll(null));
  }, [messageId]);

  useEffect(reload, [reload]);

  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (payload: { messageId: string }) => {
      if (payload.messageId === messageId) reload();
    };
    socket.on("poll:update", onUpdate);
    return () => {
      socket.off("poll:update", onUpdate);
    };
  }, [messageId, reload]);

  // `closed` is decided by the server, so when a deadline lapses while the
  // card is on screen we refetch instead of flipping the flag locally.
  useEffect(() => {
    if (!poll || poll.closed || !poll.closesAt) return;
    const ms = new Date(poll.closesAt).getTime() - Date.now();
    if (ms <= 0 || ms > 86_400_000) return;
    const timer = setTimeout(reload, ms + 1_000);
    return () => clearTimeout(timer);
  }, [poll, reload]);

  async function vote(optionId: string) {
    if (!poll || poll.closed || busy) return;
    setBusy(true);
    try {
      setPoll(await apiFetch<PollDto>(`/polls/${poll.id}/vote`, {
        method: "POST",
        body: JSON.stringify({ optionId })
      }));
    } catch {
      // Most likely the poll closed between render and click — resync.
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function closePoll() {
    if (!poll || busy) return;
    setBusy(true);
    try {
      setPoll(await apiFetch<PollDto>(`/polls/${poll.id}/close`, { method: "POST" }));
    } catch {
      reload();
    } finally {
      setBusy(false);
    }
  }

  if (!poll) return null;

  const leaderVotes = Math.max(...poll.options.map((o) => o.votes), 0);

  return (
    <div className="mt-1 max-w-lg space-y-2 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-start gap-1.5 text-sm font-semibold">
          <Icon icon={BarChart3} size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          {poll.question}
        </p>
        {poll.closed && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--border)]/50 px-2 py-0.5 text-[11px] text-[var(--text-dim)]">
            <Icon icon={Lock} size={11} /> Zakończona
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {poll.options.map((opt) => {
          // Percentages are per person: with multiple answers allowed the
          // shares deliberately add up to more than 100%.
          const pct = poll.voterCount > 0 ? Math.round((opt.votes / poll.voterCount) * 100) : 0;
          const leading = poll.closed && opt.votes > 0 && opt.votes === leaderVotes;
          return (
            <div key={opt.id} className="flex items-center gap-2">
              <button
                onClick={() => void vote(opt.id)}
                disabled={poll.closed || busy}
                aria-pressed={opt.votedByMe}
                className={`relative block flex-1 overflow-hidden rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  opt.votedByMe ? "border-[var(--accent)]/60" : "border-[var(--glass-border)]"
                } ${poll.closed ? "cursor-default" : "hover:border-[var(--accent)]/50"}`}
              >
                <span
                  className={`absolute inset-y-0 left-0 transition-all duration-300 ${
                    leading ? "bg-[var(--accent)]/25" : "bg-[var(--accent)]/15"
                  }`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
                <span className="relative flex items-center justify-between gap-2">
                  <span
                    className={`flex min-w-0 items-center gap-1.5 ${
                      opt.votedByMe ? "font-medium text-[var(--accent)]" : ""
                    }`}
                  >
                    {opt.votedByMe && <Icon icon={Check} size={13} className="shrink-0" />}
                    {opt.emoji && <span className="shrink-0">{opt.emoji}</span>}
                    <span className="truncate">{opt.text}</span>
                  </span>
                  <span className="shrink-0 text-xs text-[var(--text-dim)]">
                    {opt.votes} · {pct}%
                  </span>
                </span>
              </button>

              {!poll.hideVoters && (
                // Fixed width even when empty: the bars are only comparable if
                // every row measures its percentage against the same width.
                // Dropped on narrow screens, where 80px of avatars would
                // truncate the answers; the footer link still opens the list.
                <div className="hidden w-20 shrink-0 justify-start sm:flex">
                  {opt.voterPreview.length > 0 && (
                    <button
                      onClick={() => setVotersFor(opt.id)}
                      title={`Zobacz kto wybrał: ${opt.text}`}
                      aria-label={`Zobacz kto wybrał odpowiedź ${opt.text}`}
                      className="flex items-center rounded-full p-0.5 transition-opacity hover:opacity-80"
                    >
                      {opt.voterPreview.map((v, i) => (
                        <span key={v.id} className={i > 0 ? "-ml-2" : ""}>
                          <Avatar
                            userId={v.id}
                            displayName={v.displayName}
                            url={v.avatarUrl}
                            size={22}
                            className="ring-2 ring-[var(--bg)]"
                          />
                        </span>
                      ))}
                      {opt.votes > opt.voterPreview.length && (
                        <span className="pl-1.5 text-[11px] text-[var(--text-dim)]">
                          +{opt.votes - opt.voterPreview.length}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-dim)]">
        <span>
          {poll.voterCount} {plural(poll.voterCount, "głos", "głosy", "głosów")}
        </span>
        {poll.allowMultiple && <span>· wielokrotny wybór</span>}
        {poll.hideVoters && (
          <span className="flex items-center gap-1">
            · <Icon icon={EyeOff} size={11} /> głosy ukryte
          </span>
        )}
        {!poll.closed && poll.closesAt && <span>· kończy się {formatRemaining(poll.closesAt)}</span>}

        <span className="ml-auto flex items-center gap-2">
          {!poll.hideVoters && poll.totalVotes > 0 && (
            <button
              onClick={() => setVotersFor(poll.options[0]?.id ?? null)}
              className="flex items-center gap-1 text-[var(--accent)] hover:underline"
            >
              <Icon icon={Users} size={12} /> Kto głosował
            </button>
          )}
          {poll.canClose && (
            <button
              onClick={() => void closePoll()}
              disabled={busy}
              className="text-[var(--text-dim)] hover:text-[var(--danger)] disabled:opacity-50"
            >
              Zakończ ankietę
            </button>
          )}
        </span>
      </div>

      {votersFor && (
        <PollVotersModal poll={poll} initialOptionId={votersFor} onClose={() => setVotersFor(null)} />
      )}
    </div>
  );
}
