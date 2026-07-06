import { useState, type ReactNode } from "react";
import type { MessageDto } from "@chatv2/shared";
import { ALLOWED_REACTIONS } from "@chatv2/shared";
import { FileAttachment } from "./FileAttachment.js";
import { EmbedCard } from "./EmbedCard.js";
import { Avatar } from "../../components/Avatar.js";
import { useAvatarStore } from "../../stores/avatars.js";

interface MemberLite {
  userId: string;
  displayName: string;
}

interface MessageRowProps {
  message: MessageDto;
  authorName: string;
  mine: boolean;
  grouped: boolean;
  currentUserId: string;
  members: MemberLite[];
  onEdit: (messageId: string, content: string) => void;
  onDelete: (messageId: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  onOpenThread?: (messageId: string) => void;
  onOpenProfile?: (userId: string, anchor: { x: number; y: number }) => void;
  /** Hide the thread button inside a thread panel (no nesting). */
  inThread?: boolean;
}

/**
 * Renders message content with @mention highlighting. Mentions are matched
 * against the actual member list (not a free regex), so "@random text"
 * without a matching user renders as plain text — no false positives.
 */
export function renderContentWithMentions(
  content: string,
  members: MemberLite[],
  currentUserId: string
): ReactNode[] {
  if (!content.includes("@")) return [content];

  const sorted = [...members].sort((a, b) => b.displayName.length - a.displayName.length);
  const nodes: ReactNode[] = [];
  let rest = content;
  let key = 0;

  while (rest.length > 0) {
    const at = rest.indexOf("@");
    if (at === -1) {
      nodes.push(rest);
      break;
    }
    const match = sorted.find((m) =>
      rest.slice(at + 1).toLowerCase().startsWith(m.displayName.toLowerCase())
    );
    if (!match) {
      nodes.push(rest.slice(0, at + 1));
      rest = rest.slice(at + 1);
      continue;
    }
    if (at > 0) nodes.push(rest.slice(0, at));
    const isMe = match.userId === currentUserId;
    nodes.push(
      <span
        key={`m-${key++}`}
        className={`rounded px-1 font-medium ${
          isMe
            ? "bg-[var(--warning)]/25 text-[var(--warning)]"
            : "bg-[var(--accent)]/15 text-[var(--accent)]"
        }`}
      >
        @{match.displayName}
      </span>
    );
    rest = rest.slice(at + 1 + match.displayName.length);
  }

  return nodes;
}

export function MessageRow({
  message: m,
  authorName,
  mine,
  grouped,
  currentUserId,
  members,
  onEdit,
  onDelete,
  onReact,
  onOpenThread,
  onOpenProfile,
  inThread = false
}: MessageRowProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(m.content);
  const isTemp = m.id.startsWith("temp-");
  const isDeleted = !m.content && !m.files?.length && m.contentType === "text";
  const avatarUrl = useAvatarStore((s) => s.urls[m.authorId]);

  function submitEdit() {
    const v = editValue.trim();
    if (v && v !== m.content) onEdit(m.id, v);
    setEditing(false);
  }

  return (
    <div className="group relative">
      {!grouped && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => onOpenProfile?.(m.authorId, { x: e.clientX, y: e.clientY })}
            className="shrink-0 rounded-full transition-transform hover:scale-105"
          >
            <Avatar userId={m.authorId} displayName={authorName} url={avatarUrl} size={20} />
          </button>
          <button
            type="button"
            onClick={(e) => onOpenProfile?.(m.authorId, { x: e.clientX, y: e.clientY })}
            className={`text-sm font-semibold hover:underline ${mine ? "text-[var(--accent)]" : ""}`}
          >
            {authorName}
          </button>
          <span
            className="text-xs text-[var(--text-dim)]"
            title={new Date(m.createdAt).toLocaleString("pl-PL")}
          >
            {new Date(m.createdAt).toLocaleTimeString("pl-PL", {
              hour: "2-digit",
              minute: "2-digit"
            })}
          </span>
        </div>
      )}

      {/* Hover actions */}
      {!isTemp && !editing && (
        <div className="absolute -top-3 right-0 z-10 hidden items-center gap-0.5 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-strong)] px-1 py-0.5 shadow-lg backdrop-blur-md group-hover:flex">
          <button
            onClick={() => setShowPicker((v) => !v)}
            title="Dodaj reakcję"
            className="rounded px-1.5 py-0.5 text-sm hover:bg-[var(--border)]/50"
          >
            🙂
          </button>
          {!inThread && onOpenThread && (
            <button
              onClick={() => onOpenThread(m.id)}
              title="Odpowiedz w wątku"
              className="rounded px-1.5 py-0.5 text-sm hover:bg-[var(--border)]/50"
            >
              💬
            </button>
          )}
          {mine && (
            <>
              <button
                onClick={() => {
                  setEditValue(m.content);
                  setEditing(true);
                }}
                title="Edytuj"
                className="rounded px-1.5 py-0.5 text-sm hover:bg-[var(--border)]/50"
              >
                ✏️
              </button>
              <button
                onClick={() => onDelete(m.id)}
                title="Cofnij wiadomość"
                className="rounded px-1.5 py-0.5 text-sm hover:bg-[var(--danger)]/20"
              >
                🗑️
              </button>
            </>
          )}
        </div>
      )}

      {/* Reaction picker */}
      {showPicker && (
        <div className="animate-spring-in absolute -top-11 right-0 z-20 flex gap-0.5 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-strong)] px-1.5 py-1 shadow-xl backdrop-blur-lg">
          {ALLOWED_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                onReact(m.id, emoji);
                setShowPicker(false);
              }}
              className="rounded-lg px-1 py-0.5 text-base transition-transform hover:scale-125"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Content / edit form */}
      {editing ? (
        <div className="mt-0.5 flex gap-1.5">
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitEdit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="flex-1 rounded-lg border border-[var(--accent)] bg-[var(--glass)] px-2 py-1 text-[13px] outline-none"
          />
          <button
            onClick={submitEdit}
            className="rounded-lg bg-[var(--accent)] px-2 py-1 text-xs text-white"
          >
            Zapisz
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded-lg px-2 py-1 text-xs text-[var(--text-dim)]"
          >
            Anuluj
          </button>
        </div>
      ) : isDeleted ? (
        <p className="text-[13px] italic leading-relaxed text-[var(--text-dim)]">
          Wiadomość została cofnięta
        </p>
      ) : (
        m.content && (
          <p className={`text-[13px] leading-relaxed ${isTemp ? "opacity-50" : ""}`}>
            {renderContentWithMentions(m.content, members, currentUserId)}
            {m.editedAt && (
              <span className="ml-1 text-xs text-[var(--text-dim)]">(edytowano)</span>
            )}
          </p>
        )
      )}

      {m.files?.map((f) => <FileAttachment key={f.id} file={f} />)}
      {m.embeds?.map((e) => <EmbedCard key={e.id} embed={e} />)}

      {/* Reactions */}
      {m.reactions && m.reactions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {m.reactions.map((r) => {
            const iReacted = r.userIds.includes(currentUserId);
            return (
              <button
                key={r.emoji}
                onClick={() => onReact(m.id, r.emoji)}
                className={`animate-spring-in flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-all ${
                  iReacted
                    ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                    : "border-[var(--glass-border)] bg-[var(--glass)] hover:border-[var(--accent)]/40"
                }`}
              >
                <span>{r.emoji}</span>
                <span className="font-medium">{r.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Thread indicator */}
      {!inThread && (m.replyCount ?? 0) > 0 && onOpenThread && (
        <button
          onClick={() => onOpenThread(m.id)}
          className="mt-1 flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
        >
          💬 {m.replyCount} {m.replyCount === 1 ? "odpowiedź" : "odpowiedzi"}
        </button>
      )}
    </div>
  );
}
