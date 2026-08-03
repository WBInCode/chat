import { useState, useEffect, useMemo } from "react";
import type { MessageDto } from "@chatv2/shared";
import { ALLOWED_REACTIONS } from "@chatv2/shared";
import { FileAttachment } from "./FileAttachment.js";
import { EmbedCard } from "./EmbedCard.js";
import { Lightbox, type LightboxImage } from "./Lightbox.js";
import { Avatar } from "../../components/Avatar.js";
import { useAvatarStore } from "../../stores/avatars.js";
import { useChatStore } from "../../stores/chat.js";
import { renderMarkdown } from "./markdown.js";
import { PollCard } from "./PollCard.js";
import { EmojiPicker, type PickerAnchor } from "./EmojiPicker.js";
import { Icon } from "../../components/Icon.js";
import { decryptFromPeer, decodePayload } from "../../lib/e2e.js";
import { E2eFileAttachment } from "./E2eFileAttachment.js";
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
  Radio,
  ShieldCheck
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
  /** DM peer's public key for decrypting E2E content (null = cannot decrypt). */
  e2ePeerKey?: string | null;
  /** Who has read up to (at least) this message — shown as a small avatar
   *  stack under it. Only meaningful on the sender's own latest message. */
  readBy?: MemberLite[] | undefined;
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
  threadsEnabled = true,
  e2ePeerKey = null,
  readBy = []
}: MessageRowProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [showFullPicker, setShowFullPicker] = useState(false);
  const [fullPickerAnchor, setFullPickerAnchor] = useState<PickerAnchor | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(m.content);
  // Godzina i pasek akcji pojawiają się wyłącznie po kliknięciu wiadomości.
  // Wcześniej wyskakiwały na najechanie, przez co lista migotała przy każdym
  // ruchu myszy. Wybór trzymamy w magazynie, żeby otwarta była tylko jedna.
  const selectedMessageId = useChatStore((s) => s.selectedMessageId);
  const setSelectedMessage = useChatStore((s) => s.setSelectedMessage);
  const showActions = selectedMessageId === m.id;
  const isTemp = m.id.startsWith("temp-");
  const isDeleted = !m.content && !m.files?.length && m.contentType === "text";
  const isE2e = m.contentType === "e2e";
  // E2E: decrypt at render time on the client. null = this device cannot
  // decrypt (missing/rotated keys) — an honest placeholder is shown.
  // The decrypted body may carry attachments alongside the text.
  const e2ePayload = useMemo(() => {
    if (!isE2e) return null;
    if (!e2ePeerKey) return null;
    const plain = decryptFromPeer(m.content, e2ePeerKey);
    return plain === null ? null : decodePayload(plain);
  }, [isE2e, m.content, e2ePeerKey]);
  const displayContent = e2ePayload?.text ?? null;
  const avatarUrl = useAvatarStore((s) => s.urls[m.authorId]);
  const avatarUrls = useAvatarStore((s) => s.urls);

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

  // Zwiniecie wiadomosci zabiera ze soba wybierak reakcji, inaczej zostawalby
  // wiszacy nad trescia bez zadnego punktu zaczepienia.
  useEffect(() => {
    if (!showActions) setShowPicker(false);
  }, [showActions]);

  /**
   * Klikanie w treść przełącza wybór, ale nie może przeszkadzać w korzystaniu
   * z wiadomości: odnośniki, przyciski, pola i zaznaczanie tekstu działają jak
   * dotąd.
   */
  function przelaczWybor(e: React.MouseEvent) {
    if (editing || isTemp) return;
    const cel = e.target as HTMLElement;
    if (cel.closest("a, button, input, textarea, select, video, audio, [data-bez-wyboru]")) return;
    if ((window.getSelection()?.toString().length ?? 0) > 0) return;
    setSelectedMessage(showActions ? null : m.id);
  }

  // Notka systemowa: komunikat aplikacji, nie wypowiedź człowieka. Bez awatara,
  // nagłówka i paska akcji, żeby nie mieszała się z rozmową.
  if (m.contentType === "system") {
    return (
      <div id={`message-${m.id}`} className="my-1 flex items-center justify-center gap-2 px-2">
        <span className="h-px flex-1 bg-[var(--border)]" />
        <span
          className="flex items-center gap-1.5 text-center text-xs text-[var(--text-dim)]"
          title={new Date(m.createdAt).toLocaleString("pl-PL")}
        >
          <Icon icon={Radio} size={12} />
          {m.content}
          <span className="opacity-70">
            {new Date(m.createdAt).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </span>
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>
    );
  }

  return (
    <div
      id={`message-${m.id}`}
      onClick={przelaczWybor}
      className={`group relative rounded-lg transition-colors duration-500 ${
        showActions ? "bg-[var(--border)]/30" : ""
      } ${highlighted ? "bg-[var(--accent)]/15 ring-1 ring-[var(--accent)]/40" : ""}`}
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
            <Avatar userId={m.authorId} displayName={authorName} url={avatarUrl} size={22} />
          </button>
          <button
            type="button"
            onClick={(e) => onOpenProfile?.(m.authorId, { x: e.clientX, y: e.clientY })}
            className={`text-sm font-semibold hover:underline ${mine ? "text-[var(--accent)]" : ""}`}
          >
            {authorName}
          </button>
          {authorName === "Asystent AI" && (
            <span className="flex items-center gap-0.5 rounded-full bg-[var(--accent)]/15 px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent)]">
              <Icon icon={Sparkles} size={11} />
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
            <span className="flex items-center gap-1 rounded bg-[var(--warning)]/15 px-1.5 py-0.5 text-[11px] font-medium text-[var(--warning)]">
              <Icon icon={Pin} size={11} /> Przypięte
            </span>
          )}
        </div>
      )}

      {/* Pasek akcji: wyłącznie po kliknięciu wiadomości. Na wąskim ekranie
          zostaje w normalnym układzie pod treścią, bo pływający pasek zasłaniał
          połowę wiadomości. Od md wraca nad prawy górny róg. */}
      {!isTemp && !editing && showActions && (
        <>
          <div
            className="animate-tool-pop origin-top-right z-10 mt-1 flex flex-wrap items-center justify-end gap-0.5 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-strong)] px-1 py-0.5 shadow-lg backdrop-blur-md touch:[&_button]:px-2.5 touch:[&_button]:py-2 md:absolute md:-top-3 md:right-0 md:mt-0 md:flex-nowrap"
            data-bez-wyboru
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
          {onQuote && !isE2e && (
            <button
              onClick={() => onQuote(m, authorName)}
              title="Cytuj"
              className="rounded px-1.5 py-1 hover:bg-[var(--border)]/50"
            >
              <Icon icon={Quote} />
            </button>
          )}
          {onForward && !inThread && !isE2e && (
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
              {!isE2e && (
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
              )}
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
        <div
          data-bez-wyboru
          className="animate-spring-in origin-bottom-right absolute -top-11 right-0 z-20 flex items-center gap-0.5 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-strong)] px-1.5 py-1 shadow-xl backdrop-blur-lg"
        >
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
            className="flex-1 rounded-lg border border-[var(--accent)] bg-[var(--glass)] px-2 py-1 text-[14px] outline-none"
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
        <p className="text-[14px] italic leading-relaxed text-[var(--text-dim)]">
          Wiadomość została cofnięta
        </p>
      ) : isE2e ? (
        <div className={`relative text-[14px] leading-relaxed ${isTemp ? "opacity-50" : ""}`}>
          {e2ePayload === null ? (
            <p className="flex items-center gap-1.5 italic text-[var(--text-dim)]">
              <Icon icon={ShieldCheck} size={13} />
              Zaszyfrowana wiadomość. Nie można jej odczytać na tym urządzeniu.
            </p>
          ) : (
            <>
              {displayContent && renderMarkdown(displayContent, members, currentUserId)}
              {displayContent && (
                <span
                  className="ml-1 inline-flex translate-y-[2px] text-[var(--accent-2)]"
                  title="Wiadomość szyfrowana end-to-end"
                >
                  <Icon icon={ShieldCheck} size={11} />
                </span>
              )}
              {m.editedAt && (
                <span className="ml-1 text-xs text-[var(--text-dim)]">(edytowano)</span>
              )}
              {e2ePayload.files?.map((f) => <E2eFileAttachment key={f.id} file={f} />)}
            </>
          )}
        </div>
      ) : (
        m.content &&
        m.contentType !== "poll" && (
          <div className={`relative text-[14px] leading-relaxed ${isTemp ? "opacity-50" : ""}`}>
            {renderMarkdown(m.content, members, currentUserId)}
            {m.editedAt && (
              <span className="ml-1 text-xs text-[var(--text-dim)]">(edytowano)</span>
            )}
            {/* Zgrupowane wiadomości nie mają nagłówka z autorem i godziną,
                więc godzina pojawia się tu po kliknięciu. */}
            {grouped && showActions && (
              <span
                className="ml-1.5 text-[11px] text-[var(--text-dim)]"
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
                className={`animate-spring-in flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-all hover:scale-[1.08] active:scale-95 touch:min-h-9 touch:px-3 ${
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
          className="mt-1 flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline touch:min-h-9"
        >
          <Icon icon={MessageSquare} size={14} /> {m.replyCount} {m.replyCount === 1 ? "odpowiedź" : "odpowiedzi"}
        </button>
      )}

      {/* Read receipt: who has seen this specific message (shown directly
          under it, not in a shared bar at the bottom of the conversation). */}
      {readBy.length > 0 && (
        <div
          className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-dim)]"
          title={`Przeczytane przez: ${readBy.map((r) => r.displayName).join(", ")}`}
        >
          <span className="flex -space-x-1.5">
            {readBy.slice(0, 5).map((r) => (
              <Avatar
                key={r.userId}
                userId={r.userId}
                displayName={r.displayName}
                url={avatarUrls[r.userId]}
                size={18}
                className="ring-1 ring-[var(--bg)]"
              />
            ))}
          </span>
          <span>Przeczytane{readBy.length > 5 ? ` +${readBy.length - 5}` : ""}</span>
        </div>
      )}
    </div>
  );
}
