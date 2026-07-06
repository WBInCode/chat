import { useEffect, useMemo, useRef, useState, type FormEvent, type DragEvent, type ClipboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link } from "react-router-dom";
import type { MessageDto } from "@chatv2/shared";
import { apiFetch } from "../../lib/api.js";
import { uploadFile, isAllowedFileType, MAX_FILE_SIZE_BYTES } from "../../lib/upload.js";
import { connectSocket, disconnectSocket, getSocket } from "../../lib/socket.js";
import { useAuthStore } from "../../stores/auth.js";
import { useChatStore, type ChannelItem } from "../../stores/chat.js";
import { MessageRow } from "./MessageRow.js";
import { ThreadPanel } from "./ThreadPanel.js";
import { ProfileCard } from "./ProfileCard.js";
import { ThemeToggle } from "../settings/ThemeToggle.js";
import { PresenceToggle } from "../settings/PresenceToggle.js";
import { Avatar } from "../../components/Avatar.js";
import { useAvatarStore } from "../../stores/avatars.js";
import { useIdlePresence } from "../../lib/idlePresence.js";

interface OrgItem {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface MemberItem {
  userId: string;
  displayName: string;
  email: string;
}

interface SearchResult {
  messageId: string;
  channelId: string;
  channelName: string | null;
  authorId: string;
  content: string;
  createdAt: string;
}

interface PendingAttachment {
  localId: string;
  file: File;
  previewUrl: string | null;
  progress: number;
  error: string | null;
  fileId: string | null;
}

/** Presence dot color per status — matches the legend in the sidebar. */
function presenceDotClass(status: "online" | "away" | "dnd" | "offline" | undefined): string {
  switch (status) {
    case "online":
      return "bg-[var(--accent-2)] presence-pulse";
    case "away":
      return "bg-[var(--warning)]";
    case "dnd":
      return "bg-[var(--danger)]";
    default:
      return "bg-[var(--border)]";
  }
}

export function ChatLayout() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clear);
  const {
    activeOrgId,
    activeChannelId,
    channels,
    messages,
    typingUsers,
    presenceStatus,
    setActiveOrg,
    setActiveChannel,
    setChannels,
    setMessages,
    clearUnread,
    addMessage,
    updateMessage,
    removeMessage,
    updateFileStatus,
    updatePreviewStatus,
    addEmbeds,
    updateReactions,
    incrementReplyCount,
    openThreadId,
    setOpenThread,
    setTyping,
    setPresence
  } = useChatStore();

  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [profileCard, setProfileCard] = useState<{ userId: string; anchor: { x: number; y: number } } | null>(null);
  const avatarUrls = useAvatarStore((s) => s.urls);
  useIdlePresence(user ? getSocket() : null);
  const [draft, setDraft] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Ctrl/Cmd+K focuses message search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setSearchResults(null);
        setOpenThread(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpenThread]);

  // ── bootstrap: orgs → channels → socket ────────────────────────────────
  useEffect(() => {
    void apiFetch<OrgItem[]>("/orgs").then((data) => {
      setOrgs(data);
      if (data[0]) setActiveOrg(data[0].id);
    });
  }, [setActiveOrg]);

  useEffect(() => {
    if (!activeOrgId) return;
    void apiFetch<ChannelItem[]>(`/orgs/${activeOrgId}/channels`).then((data) => {
      setChannels(data);
      if (data[0]) setActiveChannel(data[0].id);
    });
    void apiFetch<MemberItem[]>(`/orgs/${activeOrgId}/members`).then((data) => {
      setMembers(data);
      useAvatarStore.getState().ensure(data.map((m) => m.userId));
    });
  }, [activeOrgId, setChannels, setActiveChannel]);

  useEffect(() => {
    const socket = connectSocket();

    // Thread replies (parentId set) render only in the thread panel; the
    // main list shows top-level messages with a reply counter instead.
    socket.on("message:new", (m) => {
      if (!m.parentId) addMessage(m);
      else incrementReplyCount(m.channelId, m.parentId);
    });
    socket.on("message:updated", (m) => updateMessage(m));
    socket.on("message:deleted", ({ channelId, messageId }) =>
      removeMessage(channelId, messageId)
    );
    socket.on("typing:update", ({ channelId, userId, isTyping }) =>
      setTyping(channelId, userId, isTyping)
    );
    socket.on("presence:update", ({ userId, status }) => setPresence(userId, status));
    socket.on("file:status", ({ channelId, fileId, status }) =>
      updateFileStatus(channelId, fileId, status)
    );
    socket.on("file:preview", ({ channelId, fileId, previewStatus }) =>
      updatePreviewStatus(channelId, fileId, previewStatus)
    );
    socket.on("message:embeds", ({ messageId, embeds }) => addEmbeds(messageId, embeds));
    socket.on("reaction:update", ({ channelId, messageId, reactions }) =>
      updateReactions(channelId, messageId, reactions)
    );

    return () => {
      socket.off("message:new");
      socket.off("message:updated");
      socket.off("message:deleted");
      socket.off("typing:update");
      socket.off("presence:update");
      socket.off("file:status");
      socket.off("file:preview");
      socket.off("message:embeds");
      socket.off("reaction:update");
      disconnectSocket();
    };
  }, [
    addMessage,
    updateMessage,
    removeMessage,
    setTyping,
    setPresence,
    updateFileStatus,
    updatePreviewStatus,
    addEmbeds,
    updateReactions,
    incrementReplyCount
  ]);

  // ── history for the active channel ─────────────────────────────────────
  useEffect(() => {
    if (!activeChannelId) return;
    void apiFetch<{ messages: MessageDto[] }>(
      `/channels/${activeChannelId}/messages?limit=50`
    ).then((data) => {
      // API returns newest-first; store keeps oldest-first.
      const ordered = [...data.messages].reverse();
      setMessages(activeChannelId, ordered);
      // Mark the newest message read and clear the unread badge.
      const newest = ordered[ordered.length - 1];
      if (newest) {
        getSocket().emit("read:mark", {
          channelId: activeChannelId,
          messageId: newest.id
        });
      }
      clearUnread(activeChannelId);
    });
  }, [activeChannelId, setMessages, clearUnread]);

  const channelMessages = useMemo(
    () => (activeChannelId ? (messages[activeChannelId] ?? []) : []),
    [messages, activeChannelId]
  );

  // Virtualized list: only visible rows (+ overscan) are mounted, so a
  // channel with thousands of messages stays smooth to scroll. Row heights
  // vary (text vs. images vs. embeds), so measureElement remeasures each
  // real DOM node after render instead of assuming a fixed height.
  const rowVirtualizer = useVirtualizer({
    count: channelMessages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 10
  });

  useEffect(() => {
    if (channelMessages.length > 0) {
      rowVirtualizer.scrollToIndex(channelMessages.length - 1, { align: "end" });
    }
  }, [channelMessages.length, rowVirtualizer]);

  const memberById = useMemo(() => {
    const map = new Map<string, MemberItem>();
    for (const m of members) map.set(m.userId, m);
    return map;
  }, [members]);

  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const typingNames = [...(typingUsers[activeChannelId ?? ""] ?? [])]
    .filter((id) => id !== user?.id)
    .map((id) => memberById.get(id)?.displayName ?? "Ktoś");

  // ── actions ────────────────────────────────────────────────────────────
  function addFiles(files: FileList | File[]) {
    const list = Array.from(files).slice(0, 10 - pending.length);
    const next: PendingAttachment[] = list.map((file) => ({
      localId: crypto.randomUUID(),
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      progress: 0,
      error:
        file.size > MAX_FILE_SIZE_BYTES
          ? "Plik jest za duży (limit 25 MB)"
          : !isAllowedFileType(file.type)
            ? "Nieobsługiwany typ pliku"
            : null,
      fileId: null
    }));
    setPending((p) => [...p, ...next]);
  }

  function removePending(localId: string) {
    setPending((p) => {
      const target = p.find((f) => f.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return p.filter((f) => f.localId !== localId);
    });
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items
      .filter((i) => i.kind === "file")
      .map((i) => i.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }

  async function uploadPending(channelId: string): Promise<string[]> {
    const uploadable = pending.filter((p) => !p.error && !p.fileId);
    const results = await Promise.all(
      uploadable.map(async (p) => {
        try {
          const res = await uploadFile(p.file, channelId, (pct) =>
            setPending((cur) =>
              cur.map((c) => (c.localId === p.localId ? { ...c, progress: pct } : c))
            )
          );
          setPending((cur) =>
            cur.map((c) => (c.localId === p.localId ? { ...c, fileId: res.fileId, progress: 100 } : c))
          );
          return res.fileId;
        } catch (err) {
          setPending((cur) =>
            cur.map((c) =>
              c.localId === p.localId
                ? { ...c, error: err instanceof Error ? err.message : "Błąd wysyłania" }
                : c
            )
          );
          return null;
        }
      })
    );
    return [
      ...pending.filter((p) => p.fileId).map((p) => p.fileId as string),
      ...results.filter((r): r is string => r !== null)
    ];
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    const hasFiles = pending.length > 0;
    if ((!content && !hasFiles) || !activeChannelId || !user) return;

    let fileIds: string[] = [];
    if (hasFiles) {
      fileIds = await uploadPending(activeChannelId);
      if (fileIds.length === 0 && !content) return; // all uploads failed, nothing to send
    }

    const tempId = `temp-${crypto.randomUUID()}`;
    // Optimistic UI: render immediately, reconciled by tempId on message:new.
    addMessage({
      id: tempId,
      channelId: activeChannelId,
      authorId: user.id,
      content,
      contentType: fileIds.length > 0 ? "file" : "text",
      parentId: null,
      editedAt: null,
      createdAt: new Date().toISOString()
    });

    getSocket().emit("message:send", { channelId: activeChannelId, tempId, content, fileIds });
    getSocket().emit("typing:stop", { channelId: activeChannelId });
    setDraft("");
    for (const p of pending) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    setPending([]);
  }

  function handleDraftChange(value: string) {
    setDraft(value);
    // @mention autocomplete: detect a trailing "@query" fragment.
    const match = value.match(/@([\p{L}\d ]{0,30})$/u);
    setMentionQuery(match ? (match[1] ?? "") : null);
    if (!activeChannelId) return;
    getSocket().emit("typing:start", { channelId: activeChannelId });
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      if (activeChannelId) getSocket().emit("typing:stop", { channelId: activeChannelId });
    }, 2000);
  }

  function insertMention(displayName: string) {
    setDraft((d) => d.replace(/@([\p{L}\d ]{0,30})$/u, `@${displayName} `));
    setMentionQuery(null);
  }

  const mentionCandidates =
    mentionQuery !== null
      ? members
          .filter(
            (m) =>
              m.userId !== user?.id &&
              m.displayName.toLowerCase().startsWith(mentionQuery.toLowerCase())
          )
          .slice(0, 5)
      : [];

  // ── message actions ────────────────────────────────────────────────
  function handleEditMessage(messageId: string, content: string) {
    getSocket().emit("message:edit", { messageId, content });
  }

  function handleDeleteMessage(messageId: string) {
    getSocket().emit("message:delete", { messageId });
  }

  function handleReact(messageId: string, emoji: string) {
    getSocket().emit("reaction:toggle", { messageId, emoji });
  }

  async function handleStartDm(targetUserId: string) {
    if (!activeOrgId) return;
    const dm = await apiFetch<{ id: string }>(`/orgs/${activeOrgId}/dm`, {
      method: "POST",
      body: JSON.stringify({ targetUserId })
    });
    const refreshed = await apiFetch<ChannelItem[]>(`/orgs/${activeOrgId}/channels`);
    setChannels(refreshed);
    setActiveChannel(dm.id);
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    void runSearch(searchTerm);
  }

  async function runSearch(term: string) {
    const q = term.trim();
    if (q.length < 2 || !activeOrgId) {
      setSearchResults(null);
      return;
    }
    const data = await apiFetch<{ results: SearchResult[] }>(
      `/search?orgId=${activeOrgId}&q=${encodeURIComponent(q)}`
    );
    setSearchResults(data.results);
  }

  function handleSearchInput(value: string) {
    setSearchTerm(value);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (value.trim().length < 2) {
      setSearchResults(null);
      return;
    }
    searchDebounce.current = setTimeout(() => void runSearch(value), 300);
  }

  function openSearchResult(channelId: string) {
    setSearchResults(null);
    setSearchTerm("");
    setActiveChannel(channelId);
  }

  async function handleLogout() {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      disconnectSocket();
      clearAuth();
    }
  }

  // ── render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full gap-3 p-3">
      <aside className="glass flex w-64 shrink-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] p-4">
          <span className="font-semibold">
            {orgs.find((o) => o.id === activeOrgId)?.name ?? "chatv2"}
          </span>
          <div className="flex items-center gap-1">
            <PresenceToggle />
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="text-xs text-[var(--text-dim)] transition-colors hover:text-[var(--danger)]"
            >
              Wyloguj
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">
            Kanały
          </p>
          {channels
            .filter((c) => c.type !== "DM")
            .map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveChannel(c.id)}
                className={`nav-item flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-all duration-150 ${
                  c.id === activeChannelId
                    ? "bg-[var(--accent)]/15 text-[var(--accent)] shadow-[inset_0_0_0_1px_rgba(91,124,255,0.25)]"
                    : "text-[var(--text)] hover:bg-[var(--border)]/50"
                }`}
              >
                <span>
                  {c.type === "PRIVATE" ? "🔒" : "#"} {c.name}
                </span>
                {(c.unreadCount ?? 0) > 0 && (
                  <span className="animate-spring-in ml-2 min-w-5 rounded-full bg-[var(--accent)] px-1.5 text-center text-xs font-semibold text-white">
                    {c.unreadCount}
                  </span>
                )}
              </button>
            ))}

          <p className="mt-4 px-2 py-1 text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">
            Wiadomości bezpośrednie
          </p>
          {channels
            .filter((c) => c.type === "DM")
            .map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveChannel(c.id)}
                className={`nav-item flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-all duration-150 ${
                  c.id === activeChannelId
                    ? "bg-[var(--accent)]/15 text-[var(--accent)] shadow-[inset_0_0_0_1px_rgba(91,124,255,0.25)]"
                    : "text-[var(--text)] hover:bg-[var(--border)]/50"
                }`}
              >
                <span>@ {c.name}</span>
                {(c.unreadCount ?? 0) > 0 && (
                  <span className="animate-spring-in ml-2 min-w-5 rounded-full bg-[var(--accent)] px-1.5 text-center text-xs font-semibold text-white">
                    {c.unreadCount}
                  </span>
                )}
              </button>
            ))}

          <p className="mt-4 px-2 py-1 text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">
            Zespół
          </p>
          {members
            .filter((m) => m.userId !== user?.id)
            .map((m) => (
              <button
                key={m.userId}
                onClick={() => void handleStartDm(m.userId)}
                title={`Napisz do: ${m.displayName}`}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-[var(--text)] transition-colors duration-150 hover:bg-[var(--border)]/50"
              >
                <span className="relative shrink-0">
                  <Avatar userId={m.userId} displayName={m.displayName} url={avatarUrls[m.userId]} size={24} />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 inline-block h-2.5 w-2.5 rounded-full ring-2 ring-[var(--bg)] transition-colors duration-300 ${presenceDotClass(presenceStatus[m.userId])}`}
                  />
                </span>
                {m.displayName}
              </button>
            ))}
        </div>

        <div className="border-t border-[var(--glass-border)] p-3 text-sm">
          <div className="flex items-center justify-between">
            <span>
              <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[var(--accent-2)]" />
              {user?.displayName ?? "—"}
            </span>
            <div className="flex items-center gap-2">
              {["OWNER", "ADMIN", "HR"].includes(
                orgs.find((o) => o.id === activeOrgId)?.role ?? ""
              ) && (
                <Link
                  to="/admin/members"
                  title="Panel administracyjny"
                  className="text-xs text-[var(--text-dim)] transition-colors hover:text-[var(--text)]"
                >
                  Admin
                </Link>
              )}
              <Link
                to="/settings"
                title="Ustawienia"
                className="text-xs text-[var(--text-dim)] transition-colors hover:text-[var(--text)]"
              >
                Ustawienia
              </Link>
            </div>
          </div>
        </div>
      </aside>

      <main className="glass flex min-w-0 flex-1 flex-col overflow-hidden">
        {activeChannel ? (
          <>
            <header className="flex items-center justify-between gap-4 border-b border-[var(--glass-border)] px-4 py-3">
              <h1 className="text-sm font-semibold">
                {activeChannel.type === "DM" ? "@" : activeChannel.type === "PRIVATE" ? "🔒" : "#"}{" "}
                {activeChannel.name}
              </h1>
              <form onSubmit={handleSearch} className="relative">
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchTerm}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  placeholder="Szukaj wiadomości...  (Ctrl+K)"
                  className="w-56 rounded-full border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-1.5 text-xs outline-none backdrop-blur-sm transition-shadow focus:ring-2 focus:ring-[var(--accent)]"
                />
              </form>
            </header>

            {searchResults !== null && (
              <div className="animate-slide-up border-b border-[var(--glass-border)] bg-[var(--glass)] px-4 py-2 backdrop-blur-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--text-dim)]">
                    Wyniki wyszukiwania ({searchResults.length})
                  </span>
                  <button
                    onClick={() => setSearchResults(null)}
                    className="text-xs text-[var(--text-dim)] transition-colors hover:text-[var(--text)]"
                  >
                    Zamknij
                  </button>
                </div>
                {searchResults.length === 0 ? (
                  <p className="py-2 text-xs text-[var(--text-dim)]">Brak wyników.</p>
                ) : (
                  <ul className="max-h-48 space-y-1 overflow-y-auto">
                    {searchResults.map((r) => (
                      <li key={r.messageId}>
                        <button
                          onClick={() => openSearchResult(r.channelId)}
                          className="w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--border)]/40"
                        >
                          <span className="text-[var(--text-dim)]">
                            {r.channelName ? `#${r.channelName}` : "@ DM"} ·{" "}
                            {memberById.get(r.authorId)?.displayName ?? "Nieznany"}
                          </span>
                          <span className="block text-[var(--text)]">{r.content}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div
              ref={scrollRef}
              className="relative flex-1 overflow-y-auto px-4 py-3"
              aria-live="polite"
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
            >
              {isDragOver && (
                <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-[var(--accent)] bg-[var(--accent)]/10 text-sm font-medium text-[var(--accent)]">
                  Upuść, aby wysłać
                </div>
              )}
              <div
                style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const m = channelMessages[virtualRow.index]!;
                  const prev = channelMessages[virtualRow.index - 1];
                  const grouped =
                    prev &&
                    prev.authorId === m.authorId &&
                    new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() <
                      5 * 60 * 1000;
                  const author = memberById.get(m.authorId);
                  const mine = m.authorId === user?.id;

                  return (
                    <div
                      key={m.id}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                      /* NOTE: no animation classes here — the row's own
                         `transform` positions it; animating transform on the
                         same element would override the virtualizer offset
                         and stack every message at y=0. Padding (not margin)
                         is used for spacing because measureElement measures
                         border-box, which excludes margins. */
                      className={grouped ? "pt-0.5 pb-0.5" : "pt-3 pb-0.5"}
                    >
                      <MessageRow
                        message={m}
                        authorName={author?.displayName ?? "Nieznany"}
                        mine={mine}
                        grouped={!!grouped}
                        currentUserId={user?.id ?? ""}
                        members={members}
                        onEdit={handleEditMessage}
                        onDelete={handleDeleteMessage}
                        onReact={handleReact}
                        onOpenThread={setOpenThread}
                        onOpenProfile={(userId, anchor) => setProfileCard({ userId, anchor })}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex h-5 items-center gap-1.5 px-4 text-xs text-[var(--text-dim)]">
              {typingNames.length > 0 && (
                <>
                  <span className="flex gap-0.5">
                    <span className="typing-dot h-1 w-1 rounded-full bg-[var(--text-dim)]" />
                    <span className="typing-dot h-1 w-1 rounded-full bg-[var(--text-dim)]" />
                    <span className="typing-dot h-1 w-1 rounded-full bg-[var(--text-dim)]" />
                  </span>
                  {typingNames.join(", ")} pisze...
                </>
              )}
            </div>

            <form onSubmit={handleSend} className="border-t border-[var(--glass-border)] p-3">
              {pending.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {pending.map((p) => (
                    <div
                      key={p.localId}
                      className="animate-spring-in relative flex items-center gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1.5 text-xs"
                    >
                      {p.previewUrl ? (
                        <img src={p.previewUrl} alt="" className="h-8 w-8 rounded object-cover" />
                      ) : (
                        <span className="text-base">📎</span>
                      )}
                      <span className="max-w-[10rem] truncate">{p.file.name}</span>
                      {p.error ? (
                        <span className="text-[var(--danger)]">{p.error}</span>
                      ) : p.progress > 0 && p.progress < 100 ? (
                        <span className="text-[var(--text-dim)]">{p.progress}%</span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removePending(p.localId)}
                        className="ml-1 text-[var(--text-dim)] transition-colors hover:text-[var(--danger)]"
                        aria-label="Usuń załącznik"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="relative flex gap-2">
                {mentionCandidates.length > 0 && (
                  <div className="animate-slide-up absolute bottom-full left-12 z-20 mb-1 w-56 overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-strong)] shadow-xl backdrop-blur-lg">
                    {mentionCandidates.map((m) => (
                      <button
                        key={m.userId}
                        type="button"
                        onClick={() => insertMention(m.displayName)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                      >
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${presenceDotClass(presenceStatus[m.userId])}`}
                        />
                        {m.displayName}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Załącz plik"
                  className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 text-sm transition-all duration-150 hover:bg-[var(--border)]/40 active:scale-[0.96]"
                >
                  📎
                </button>
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  onPaste={handlePaste}
                  placeholder={`Napisz na ${activeChannel.type === "DM" ? "@" : "#"}${activeChannel.name}  ·  @wzmianka · Ctrl+K szukaj`}
                  maxLength={8000}
                  className="flex-1 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 text-sm outline-none backdrop-blur-sm transition-shadow focus:ring-2 focus:ring-[var(--accent)]"
                />
                {draft.length > 7000 && (
                  <span className="absolute -top-5 right-24 text-xs text-[var(--warning)]">
                    {draft.length}/8000
                  </span>
                )}
                <button
                  type="submit"
                  disabled={!draft.trim() && pending.length === 0}
                  className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-[0_4px_16px_rgba(91,124,255,0.35)] transition-all duration-150 hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
                >
                  Wyślij
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-[var(--text-dim)]">
            <p className="text-sm">Wybierz kanał, aby rozpocząć rozmowę</p>
          </div>
        )}
      </main>

      {openThreadId && activeChannelId && user && (
        <ThreadPanel
          parentMessageId={openThreadId}
          channelId={activeChannelId}
          currentUserId={user.id}
          members={members}
          onClose={() => setOpenThread(null)}
          onEdit={handleEditMessage}
          onDelete={handleDeleteMessage}
          onReact={handleReact}
        />
      )}

      {profileCard && activeOrgId && (
        <ProfileCard
          orgId={activeOrgId}
          userId={profileCard.userId}
          anchor={profileCard.anchor}
          onClose={() => setProfileCard(null)}
        />
      )}
    </div>
  );
}
