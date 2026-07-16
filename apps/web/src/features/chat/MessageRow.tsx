import { useState, useEffect } from "react";
import type { MessageDto } from "@chatv2/shared";
import { ALLOWED_REACTIONS } from "@chatv2/shared";
import { FileAttachment } from "./FileAttachment.js";
import { EmbedCard } from "./EmbedCard.js";
import { Lightbox, type LightboxImage } from "./Lightbox.js";
import { Avatar } from "../../components/Avatar.js";
import { useAvatarStore } from "../../stores/avatars.js";
import { renderMarkdown } from "./markdown.js";
import { PollCard } from "./PollCard.js";
import { EmojiPicker, type PickerAnchor } from "./EmojiPicker.js";
import { Icon } from "../../components/Icon.js";
import {
  SmilePlus,
  MessageSquare,
  Bookmark,
  Pin,
  Quote,
  Forward,
  Link2,
  AlarmClock,
  Pencil,
  Trash2,
  Sparkles,
  MoreHorizontal
} from "lucide-react";

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
  onToggleSave?: (messageId: string) => void;
  onTogglePin?: (messageId: string, pin: boolean) => void;
  onCopyLink?: (messageId: string) => void;
  onQuote?: (message: MessageDto, authorName: string) => void;
  onForward?: (message: MessageDto, authorName: string) => void;
  onRemind?: (messageId: string) => void;
  canPin?: boolean;
  isSaved?: boolean;
  /** Highlighted briefly after navigating in via a permalink. */
  highlighted?: boolean;
  /** Renders a "New messages" divider above this row. */
  isFirstUnread?: boolean;
  /** Hide the thread button inside a thread panel (no nesting). */
  inThread?: boolean;
  /** Bumped to request opening inline edit (↑ in an empty composer). */
  autoEditNonce?: number;
  /** Module toggles (F7) — hide reaction / thread affordances when off. */
  reactionsEnabled?: boolean;
  threadsEnabled?: boolean;
}

/**
 * A group of image attachments on one message: renders the thumbnail grid
 * (single image large, 2+ tiled) and shares one lightbox with prev/next
 * navigation across them.
 */
function ImageGroup({ images }: { images: NonNullable<MessageDto["files"]> }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const lightboxImages: LightboxImage[] = images.map((f) => ({ id: f.id, name: f.name }));

  return (
    <>
      {images.length >= 2 ? (
        <div className="mt-1 grid max-w-sm grid-cols-2 gap-1">
          {images.map((f, i) => (
            <FileAttachment key={f.id} file={f} gallery onImageOpen={() => setOpenIndex(i)} />
          ))}
        </div>
      ) : (
        images.map((f, i) => (
          <FileAttachment key={f.id} file={f} onImageOpen={() => setOpenIndex(i)} />
        ))
      )}
      {openIndex !== null && (
        <Lightbox
          images={lightboxImages}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  );
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
  onToggleSave,
  onTogglePin,
  onCopyLink,
  onQuote,
  onForward,
  onRemind,
  canPin = false,
  isSaved = false,
  highlighted = false,
  isFirstUnread = false,
  inThread = false,
  autoEditNonce = 0,
  reactionsEnabled = true,
  threadsEnabled = true
}: MessageRowProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [showFullPicker, setShowFullPicker] = useState(false);
  const [fullPickerAnchor, setFullPickerAnchor] = useState<PickerAnchor | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(m.content);
  // Touch devices have no hover, so the action bar is revealed via an
  // always-visible "⋯" button on mobile (see below); on desktop it appears
  // on group-hover as before.
  const [showActions, setShowActions] = useState(false);
  const isTemp = m.id.startsWith("temp-");
  const isDeleted = !m.content && !m.files?.length && m.contentType === "text";
  const avatarUrl = useAvatarStore((s) => s.urls[m.authorId]);

  function submitEdit() {
    const v = editValue.trim();
    if (v && v !== m.content) onEdit(m.id, v);
    setEditing(false);
  }

  // Open inline edit when the composer requests it (↑ on last own message).
  useEffect(() => {
    if (autoEditNonce > 0) {
      setEditValue(m.content);
      setEditing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEditNonce]);

  return (
    <div
      id={`message-${m.id}`}
      className={`group relative rounded-lg transition-colors duration-500 hover:bg-[var(--border)]/30 ${
        highlighted ? "bg-[var(--accent)]/15 ring-1 ring-[var(--accent)]/40" : ""
      }`}
    >
      {isFirstUnread && !inThread && (
        <div className="my-2 flex items-center gap-2">
          <span className="h-px flex-1 bg-[var(--danger)]/40" />
          <span className="text-xs font-medium text-[var(--danger)]">Nowe wiadomości</span>
          <span className="h-px flex-1 bg-[var(--danger)]/40" />
        </div>
      )}
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
          {authorName === "Asystent AI" && (
            <span className="flex items-center gap-0.5 rounded-full bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
              <Icon icon={Sparkles} size={10} />
              AI
            </span>
          )}
          <span
            className="text-xs text-[var(--text-dim)]"
            title={new Date(m.createdAt).toLocaleString("pl-PL")}
          >
            {new Date(m.createdAt).toLocaleTimeString("pl-PL", {
              hour: "2-digit",
              minute: "2-digit"
            })}
          </span>
          {m.pinnedAt && (
            <span className="rounded bg-[var(--warning)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--warning)]">
              📌 Przypięte
            </span>
          )}
        </div>
      )}

      {/* Hover actions */}
      {!isTemp && !editing && (
        <>
          {/* Mobile: no hover — reveal the action bar with a tap. */}
          <button
            type="button"
            onClick={() => setShowActions((v) => !v)}
            title="Akcje"
            className="absolute -top-2 right-0 z-10 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-strong)] p-1 shadow-lg backdrop-blur-md md:hidden"
          >
            <Icon icon={MoreHorizontal} size={14} />
          </button>
          <div
            className={`animate-tool-pop origin-top-right absolute -top-3 right-0 z-10 items-center gap-0.5 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-strong)] px-1 py-0.5 shadow-lg backdrop-blur-md group-hover:flex ${
              showActions ? "flex" : "hidden"
            }`}
            onClick={() => setShowActions(false)}
          >
          {reactionsEnabled && (
            <button
              onClick={() => setShowPicker((v) => !v)}
              title="Dodaj reakcję"
              className="rounded px-1.5 py-1 hover:bg-[var(--border)]/50"
            >
              <Icon icon={SmilePlus} />
            </button>
          )}
          {!inThread && threadsEnabled && onOpenThread && (
            <button
              onClick={() => onOpenThread(m.id)}
              title="Odpowiedz w wątku"
              className="rounded px-1.5 py-1 hover:bg-[var(--border)]/50"
            >
              <Icon icon={MessageSquare} />
            </button>
          )}
          {onToggleSave && (
            <button
              onClick={() => onToggleSave(m.id)}
              title={isSaved ? "Usuń z zapisanych" : "Zapisz wiadomość"}
              className={`rounded px-1.5 py-1 hover:bg-[var(--border)]/50 ${isSaved ? "text-[var(--accent)]" : ""}`}
            >
              <Icon icon={Bookmark} className={isSaved ? "fill-current" : ""} />
            </button>
          )}
          {canPin && onTogglePin && !inThread && (
            <button
              onClick={() => onTogglePin(m.id, !m.pinnedAt)}
              title={m.pinnedAt ? "Odepnij" : "Przypnij do kanału"}
              className={`rounded px-1.5 py-1 hover:bg-[var(--border)]/50 ${m.pinnedAt ? "text-[var(--warning)]" : ""}`}
            >
              <Icon icon={Pin} className={m.pinnedAt ? "fill-current" : ""} />
            </button>
          )}
          {onQuote && (
            <button
              onClick={() => onQuote(m, authorName)}
              title="Cytuj"
              className="rounded px-1.5 py-1 hover:bg-[var(--border)]/50"
            >
              <Icon icon={Quote} />
            </button>
          )}
          {onForward && !inThread && (
            <button
              onClick={() => onForward(m, authorName)}
              title="Przekaż dalej"
              className="rounded px-1.5 py-1 hover:bg-[var(--border)]/50"
            >
              <Icon icon={Forward} />
            </button>
          )}
          {onCopyLink && !inThread && (
            <button
              onClick={() => onCopyLink(m.id)}
              title="Kopiuj link do wiadomości"
              className="rounded px-1.5 py-1 hover:bg-[var(--border)]/50"
            >
              <Icon icon={Link2} />
            </button>
          )}
          {onRemind && !inThread && (
            <button
              onClick={() => onRemind(m.id)}
              title="Przypomnij mi o tym"
              className="rounded px-1.5 py-1 hover:bg-[var(--border)]/50"
            >
              <Icon icon={AlarmClock} />
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
                className="rounded px-1.5 py-1 hover:bg-[var(--border)]/50"
              >
                <Icon icon={Pencil} />
              </button>
              <button
                onClick={() => onDelete(m.id)}
                title="Cofnij wiadomość"
                className="rounded px-1.5 py-1 hover:bg-[var(--danger)]/20"
              >
                <Icon icon={Trash2} />
              </button>
            </>
          )}
          </div>
        </>
      )}

      {/* Reaction picker */}
      {showPicker && (
        <div className="animate-spring-in origin-bottom-right absolute -top-11 right-0 z-20 flex items-center gap-0.5 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-strong)] px-1.5 py-1 shadow-xl backdrop-blur-lg">
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
          <span className="mx-0.5 h-4 w-px bg-[var(--glass-border)]" />
          <button
            title="Więcej emoji"
            onClick={(e) => {
              setFullPickerAnchor(e.currentTarget.getBoundingClientRect());
              setShowFullPicker(true);
              setShowPicker(false);
            }}
            className="rounded-lg px-1 py-0.5 text-[var(--text-dim)] transition-transform hover:scale-125 hover:text-[var(--text)]"
          >
            <Icon icon={SmilePlus} size={16} />
          </button>
        </div>
      )}

      {/* Full emoji picker */}
      {showFullPicker && (
        <EmojiPicker
          anchor={fullPickerAnchor}
          onPick={(emoji) => {
            onReact(m.id, emoji);
            setShowFullPicker(false);
          }}
          onClose={() => setShowFullPicker(false)}
        />
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
        m.content &&
        m.contentType !== "poll" && (
          <div className={`relative text-[13px] leading-relaxed ${isTemp ? "opacity-50" : ""}`}>
            {renderMarkdown(m.content, members, currentUserId)}
            {m.editedAt && (
              <span className="ml-1 text-xs text-[var(--text-dim)]">(edytowano)</span>
            )}
            {/* Grouped rows hide the header (author+time) — surface the
                timestamp on hover so the send time is still discoverable. */}
            {grouped && (
              <span
                className="ml-1.5 hidden text-[10px] text-[var(--text-dim)] group-hover:inline"
                title={new Date(m.createdAt).toLocaleString("pl-PL")}
              >
                {new Date(m.createdAt).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        )
      )}

      {(() => {
        const files = m.files ?? [];
        if (files.length === 0) return null;
        const IMAGE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
        const images = files.filter((f) => IMAGE.has(f.mimeType));
        const others = files.filter((f) => !IMAGE.has(f.mimeType));
        return (
          <>
            {/* 2+ images tile into a gallery grid; a single image stays large. */}
            {images.length >= 1 && <ImageGroup images={images} />}
            {others.map((f) => (
              <FileAttachment key={f.id} file={f} />
            ))}
          </>
        );
      })()}
      {m.embeds?.map((e) => <EmbedCard key={e.id} embed={e} />)}
      {m.contentType === "poll" && <PollCard messageId={m.id} />}

      {/* Reactions */}
      {m.reactions && m.reactions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {m.reactions.map((r) => {
            const iReacted = r.userIds.includes(currentUserId);
            return (
              <button
                key={r.emoji}
                onClick={() => onReact(m.id, r.emoji)}
                className={`animate-spring-in flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-all hover:scale-[1.08] active:scale-95 ${
                  iReacted
                    ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)] shadow-[0_2px_8px_var(--accent-glow)]"
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
