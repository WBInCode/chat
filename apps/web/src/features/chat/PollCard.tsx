import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api.js";
import { getSocket } from "../../lib/socket.js";

interface PollOptionDto {
  id: string;
  text: string;
  votes: number;
  votedByMe: boolean;
}

interface PollDto {
  id: string;
  messageId: string;
  question: string;
  allowMultiple: boolean;
  closesAt: string | null;
  totalVotes: number;
  options: PollOptionDto[];
}

/**
 * Renders a poll attached to a message: options with live vote bars, click
 * to vote/unvote. Refetches on `poll:update` WS events rather than trusting
 * the broadcast payload directly — the payload's `votedByMe` reflects the
 * voter who triggered it, not the current viewer, so trusting it blindly
 * would show the wrong person's vote state to everyone else.
 */
export function PollCard({ messageId }: { messageId: string }) {
  const [poll, setPoll] = useState<PollDto | null>(null);

  function reload() {
    void apiFetch<PollDto>(`/messages/${messageId}/poll`).then(setPoll);
  }

  useEffect(reload, [messageId]);

  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (payload: { messageId: string }) => {
      if (payload.messageId === messageId) reload();
    };
    socket.on("poll:update", onUpdate);
    return () => {
      socket.off("poll:update", onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  async function vote(optionId: string) {
    const updated = await apiFetch<PollDto>(`/polls/${poll!.id}/vote`, {
      method: "POST",
      body: JSON.stringify({ optionId })
    });
    setPoll(updated);
  }

  if (!poll) return null;

  return (
    <div className="mt-1 space-y-1.5 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] p-3">
      <p className="text-sm font-semibold">📊 {poll.question}</p>
      {poll.options.map((opt) => {
        const pct = poll.totalVotes > 0 ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;
        return (
          <button
            key={opt.id}
            onClick={() => void vote(opt.id)}
            className="relative block w-full overflow-hidden rounded-lg border border-[var(--glass-border)] px-3 py-1.5 text-left text-sm transition-colors hover:border-[var(--accent)]/50"
          >
            <span
              className="absolute inset-y-0 left-0 bg-[var(--accent)]/15 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
            <span className="relative flex items-center justify-between">
              <span className={opt.votedByMe ? "font-medium text-[var(--accent)]" : ""}>
                {opt.votedByMe ? "✓ " : ""}
                {opt.text}
              </span>
              <span className="text-xs text-[var(--text-dim)]">
                {opt.votes} · {pct}%
              </span>
            </span>
          </button>
        );
      })}
      <p className="text-xs text-[var(--text-dim)]">
        {poll.totalVotes} {poll.totalVotes === 1 ? "głos" : "głosów"}
        {poll.allowMultiple ? " · wielokrotny wybór" : ""}
      </p>
    </div>
  );
}
