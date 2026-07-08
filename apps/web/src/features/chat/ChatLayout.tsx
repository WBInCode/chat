import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type DragEvent, type ClipboardEvent } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link } from "react-router-dom";
import type { MessageDto } from "@chatv2/shared";
import { apiFetch, ApiError } from "../../lib/api.js";
import { uploadFile, isAllowedFileType, MAX_FILE_SIZE_BYTES } from "../../lib/upload.js";
import { connectSocket, disconnectSocket, getSocket } from "../../lib/socket.js";
import { useAuthStore } from "../../stores/auth.js";
import { useChatStore, type ChannelItem } from "../../stores/chat.js";
import { MessageRow } from "./MessageRow.js";
import { ThreadPanel } from "./ThreadPanel.js";
import { ProfileCard } from "./ProfileCard.js";
import { SavedPanel } from "./SavedPanel.js";
import { ForwardPicker } from "./ForwardPicker.js";
import { EmojiPicker } from "./EmojiPicker.js";
import { ChannelMembersPanel } from "./ChannelMembersPanel.js";
import { GroupDmPicker } from "./GroupDmPicker.js";
import { QuickSwitcher } from "./QuickSwitcher.js";
import { SchedulePicker } from "./SchedulePicker.js";
import { CreatePollModal } from "./CreatePollModal.js";
import { ReminderPicker } from "./ReminderPicker.js";
import { VoiceRoom } from "./VoiceRoom.js";
import { UserStatusControl } from "../../components/UserStatusControl.js";
import { SidebarSection } from "../../components/SidebarSection.js";
import { ThemeToggle } from "../settings/ThemeToggle.js";
import { Avatar } from "../../components/Avatar.js";
import { useAvatarStore } from "../../stores/avatars.js";
import { useIdlePresence } from "../../lib/idlePresence.js";
import { parseSearchFilters } from "../../lib/searchFilters.js";
import { getDraft, setDraft as setDraftPersisted, clearDraft as clearDraftPersisted, hasDraft } from "../../lib/drafts.js";
import { Icon } from "../../components/Icon.js";
import { glassButtonGhost } from "../../styles/glass.js";
import { Paperclip, BarChart3, Clock, Star, Bell, BellOff, Users, Pin, Bookmark, X, Plus, Sparkles, Mic, Menu, Send, Search, MoreVertical, Bold, Italic, Code, Link2, Strikethrough, Smile } from "lucide-react";
import { CreateChannelModal } from "./CreateChannelModal.js";
import { BrowseChannelsModal } from "./BrowseChannelsModal.js";

/** True when two dates fall on the same calendar day (local time). */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Human day label for a message divider: "Dzisiaj" / "Wczoraj" / full date. */
function formatDayLabel(date: Date): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, now)) return "Dzisiaj";
  if (isSameDay(date, yesterday)) return "Wczoraj";
  return date.toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric"
  });
}

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
    readState,
    hasMoreOlder,
    setActiveOrg,
    setActiveChannel,
    setChannels,
    setMessages,
    prependMessages,
    setHasMoreOlder,
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
    setPresence,
    setReadState,
    applyReadUpdate
  } = useChatStore();

  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [profileCard, setProfileCard] = useState<{ userId: string; anchor: { x: number; y: number } } | null>(null);
  const avatarUrls = useAvatarStore((s) => s.urls);
  const [pinnedMessages, setPinnedMessages] = useState<MessageDto[]>([]);
  const [showPinnedList, setShowPinnedList] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [forwardMessage, setForwardMessage] = useState<{ message: MessageDto; authorName: string } | null>(
    null
  );
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  // Signal to open inline edit on a specific message (↑ in an empty composer).
  const [editRequest, setEditRequest] = useState<{ id: string; nonce: number } | null>(null);
  const permalinkHandled = useRef(false);
  const permalinkInProgressRef = useRef<string | null>(null);
  const suppressAutoScrollRef = useRef(false);
  const loadingOlderRef = useRef(false);
  // Distance from the current scroll position to the bottom of the content,
  // captured right before prepending older messages so we can re-anchor the
  // viewport (the content below the prepend is unchanged).
  const restoreBottomGapRef = useRef<number | null>(null);
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  const [showGroupDmPicker, setShowGroupDmPicker] = useState(false);
  const [groupDmSelection, setGroupDmSelection] = useState<Set<string>>(new Set());
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showBrowseChannels, setShowBrowseChannels] = useState(false);
  const [digestToast, setDigestToast] = useState<string | null>(null);

  // Generic short-lived feedback toast (F6-A.4) — reuses the digest toast UI.
  function showToast(text: string, ms = 2500) {
    setDigestToast(text);
    setTimeout(() => setDigestToast(null), ms);
  }
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [reminderMessageId, setReminderMessageId] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [showAiRewriteMenu, setShowAiRewriteMenu] = useState(false);
  const [aiRewriteLoading, setAiRewriteLoading] = useState(false);
  const [inVoiceChannelId, setInVoiceChannelId] = useState<string | null>(null);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showComposerActions, setShowComposerActions] = useState(false);
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);
  const [showComposerMenu, setShowComposerMenu] = useState(false);
  const [showChannelMenu, setShowChannelMenu] = useState(false);
  const [draggedChannelId, setDraggedChannelId] = useState<string | null>(null);
  const [wsDisconnected, setWsDisconnected] = useState(false);
  useIdlePresence(user ? getSocket() : null);

  useEffect(() => {
    void apiFetch<{ enabled: boolean }>("/ai/status")
      .then((r) => setAiEnabled(r.enabled))
      .catch(() => setAiEnabled(false));
  }, []);
  const [draft, setDraft] = useState("");
  const [draftChannels, setDraftChannels] = useState<Set<string>>(new Set());
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
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Keyboard shortcut: Ctrl/Cmd+K focuses message search, Ctrl/Cmd+P opens the quick switcher.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setShowQuickSwitcher(true);
      }
      if (e.key === "Escape") {
        setSearchResults(null);
        setOpenThread(null);
        setShowQuickSwitcher(false);
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

  // ── unread digest toast: shown once right after the app loads ──────────
  useEffect(() => {
    void apiFetch<{ totalUnread: number; mentionCount: number; channelCount: number }>(
      "/me/unread-summary"
    ).then((summary) => {
      if (summary.mentionCount > 0) {
        setDigestToast(
          `📬 ${summary.mentionCount} ${summary.mentionCount === 1 ? "nowa wzmianka" : "nowe wzmianki"} w ${summary.channelCount} ${summary.channelCount === 1 ? "kanale" : "kanałach"}`
        );
        setTimeout(() => setDigestToast(null), 6000);
      }
    });
  }, []);

  // ── document title badge: total unread across non-muted channels ──────
  useEffect(() => {
    const total = channels.reduce((sum, c) => (c.muted ? sum : sum + (c.unreadCount ?? 0)), 0);
    document.title = total > 0 ? `(${total}) chatv2` : "chatv2";
  }, [channels]);

  useEffect(() => {
    if (!activeOrgId) return;
    void apiFetch<ChannelItem[]>(`/orgs/${activeOrgId}/channels`).then((data) => {
      setChannels(data);
      if (data[0]) setActiveChannel(data[0].id);
      setDraftChannels(new Set(data.filter((c) => hasDraft(c.id)).map((c) => c.id)));
    });
    void apiFetch<MemberItem[]>(`/orgs/${activeOrgId}/members`).then((data) => {
      setMembers(data);
      useAvatarStore.getState().ensure(data.map((m) => m.userId));
    });
  }, [activeOrgId, setChannels, setActiveChannel]);

  // Load the persisted draft (if any) whenever the active channel changes.
  useEffect(() => {
    if (!activeChannelId) return;
    setDraft(getDraft(activeChannelId));
  }, [activeChannelId]);

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
    socket.on("read:update", ({ channelId, userId, readAt }) =>
      applyReadUpdate(channelId, userId, readAt)
    );

    // Connection-state banner (F6-A.3): silence on network drops was
    // confusing — users kept typing into a dead socket.
    const onDisconnect = () => setWsDisconnected(true);
    const onConnect = () => setWsDisconnected(false);
    socket.on("disconnect", onDisconnect);
    socket.on("connect", onConnect);

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
      socket.off("read:update");
      socket.off("disconnect", onDisconnect);
      socket.off("connect", onConnect);
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
    incrementReplyCount,
    applyReadUpdate
  ]);

  // ── history for the active channel ─────────────────────────────────────
  useEffect(() => {
    if (!activeChannelId) return;
    if (permalinkInProgressRef.current === activeChannelId) return;
    void apiFetch<{ messages: MessageDto[] }>(
      `/channels/${activeChannelId}/messages?limit=50`
    ).then((data) => {
      // API returns newest-first; store keeps oldest-first.
      const ordered = [...data.messages].reverse();
      setMessages(activeChannelId, ordered);
      // A full page (50) implies older history may exist for infinite scroll.
      setHasMoreOlder(activeChannelId, data.messages.length >= 50);
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
    // Load per-member read receipts for this channel.
    void apiFetch<{ userId: string; lastReadAt: string | null }[]>(
      `/channels/${activeChannelId}/read-state`
    )
      .then((entries) => setReadState(activeChannelId, entries))
      .catch(() => {
        /* read receipts are best-effort */
      });
  }, [activeChannelId, setMessages, clearUnread, setReadState, setHasMoreOlder]);

  // ── pinned messages banner for the active channel ──────────────────────
  useEffect(() => {
    if (!activeChannelId) {
      setPinnedMessages([]);
      return;
    }
    void apiFetch<MessageDto[]>(`/channels/${activeChannelId}/pinned`).then(setPinnedMessages);
  }, [activeChannelId]);

  // ── which of the currently loaded messages the user has saved ─────────
  useEffect(() => {
    void apiFetch<{ message: MessageDto }[]>("/me/saved-messages").then((items) => {
      setSavedIds(new Set(items.map((i) => i.message.id)));
    });
  }, []);

  function handleTogglePin(messageId: string, pin: boolean) {
    void apiFetch<MessageDto>(`/messages/${messageId}/pin`, { method: pin ? "POST" : "DELETE" }).then(
      (updated) => {
        updateMessage(updated);
        if (activeChannelId) {
          void apiFetch<MessageDto[]>(`/channels/${activeChannelId}/pinned`).then(setPinnedMessages);
        }
      }
    );
  }

  function handleToggleSave(messageId: string) {
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.has(messageId) ? next.delete(messageId) : next.add(messageId);
      return next;
    });
    void apiFetch(`/messages/${messageId}/save`, { method: "POST" }).catch(() => {
      // revert optimistic toggle on failure
      setSavedIds((prev) => {
        const next = new Set(prev);
        next.has(messageId) ? next.delete(messageId) : next.add(messageId);
        return next;
      });
    });
  }

  async function saveTopic() {
    if (!activeChannelId) return;
    const updated = await apiFetch<{ topic: string | null }>(`/channels/${activeChannelId}/topic`, {
      method: "PATCH",
      body: JSON.stringify({ topic: topicDraft.trim() || null })
    });
    setChannels(
      channels.map((c) => (c.id === activeChannelId ? { ...c, topic: updated.topic } : c))
    );
    setEditingTopic(false);
  }

  async function toggleMute(channelId: string, muted: boolean) {
    await apiFetch(`/channels/${channelId}/mute`, { method: "PATCH", body: JSON.stringify({ muted }) });
    setChannels(channels.map((c) => (c.id === channelId ? { ...c, muted } : c)));
  }

  async function toggleFavorite(channelId: string, favorite: boolean) {
    await apiFetch(`/channels/${channelId}/favorite`, {
      method: "PATCH",
      body: JSON.stringify({ favorite })
    });
    setChannels(channels.map((c) => (c.id === channelId ? { ...c, favorite } : c)));
  }

  // Drag-and-drop reordering of the "Kanały" list (F5-I). Optimistic
  // reorder in local state first, then persist per-user via PATCH — a
  // failure just leaves the sidebar order out of sync with the server
  // until next reload, never breaks anything, so no rollback needed.
  function moveNonDmChannel(draggedId: string, targetId: string) {
    if (draggedId === targetId || !activeOrgId) return;
    const nonDm = channels.filter((c) => c.type !== "DM");
    const dmAndFav = channels.filter((c) => c.type === "DM");
    const fromIdx = nonDm.findIndex((c) => c.id === draggedId);
    const toIdx = nonDm.findIndex((c) => c.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...nonDm];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved!);
    setChannels([...reordered, ...dmAndFav]);
    void apiFetch(`/orgs/${activeOrgId}/channels/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ orderedChannelIds: reordered.map((c) => c.id) })
    }).catch(() => {
      // Non-fatal — sidebar order just won't persist across reload this time.
    });
  }

  async function runAiSummary() {
    if (!activeChannelId) return;
    setAiSummaryLoading(true);
    setAiSummary(null);
    try {
      const res = await apiFetch<{ summary: string }>(`/channels/${activeChannelId}/ai/summarize`, {
        method: "POST"
      });
      setAiSummary(res.summary);
    } catch (e) {
      setAiSummary(e instanceof ApiError ? e.message : "Nie udało się podsumować kanału.");
    } finally {
      setAiSummaryLoading(false);
    }
  }

  async function runAiRewrite(mode: string) {
    if (!activeOrgId || !draft.trim()) return;
    setShowAiRewriteMenu(false);
    setAiRewriteLoading(true);
    try {
      const res = await apiFetch<{ result: string }>(`/ai/rewrite?orgId=${activeOrgId}`, {
        method: "POST",
        body: JSON.stringify({ text: draft, mode })
      });
      setDraft(res.result);
    } catch (e) {
      setAiSummary(e instanceof ApiError ? e.message : "AI nie odpowiedziało — spróbuj ponownie.");
    } finally {
      setAiRewriteLoading(false);
    }
  }

  async function createGroupDm() {
    if (!activeOrgId || groupDmSelection.size < 2) return;
    const dm = await apiFetch<{ id: string }>(`/orgs/${activeOrgId}/group-dm`, {
      method: "POST",
      body: JSON.stringify({ memberUserIds: [...groupDmSelection] })
    });
    const refreshed = await apiFetch<ChannelItem[]>(`/orgs/${activeOrgId}/channels`);
    setChannels(refreshed);
    setActiveChannel(dm.id);
    setShowGroupDmPicker(false);
    setGroupDmSelection(new Set());
  }

  const channelMessages = useMemo(
    () => (activeChannelId ? (messages[activeChannelId] ?? []) : []),
    [messages, activeChannelId]
  );

  // Read receipts (F6-C): find the current user's latest own message and the
  // members (excluding self) who have read at least up to it. Shown as a
  // compact "seen by" row under the conversation.
  const readReceipt = useMemo(() => {
    if (!activeChannelId || !user?.id) return null;
    // DMs and small channels benefit most; skip if there are no other members.
    let lastOwn: (typeof channelMessages)[number] | undefined;
    for (let i = channelMessages.length - 1; i >= 0; i--) {
      if (channelMessages[i]!.authorId === user.id) {
        lastOwn = channelMessages[i];
        break;
      }
    }
    if (!lastOwn) return null;
    const sentAt = new Date(lastOwn.createdAt).getTime();
    const perChannel = readState[activeChannelId] ?? {};
    const readers = members.filter(
      (mem) =>
        mem.userId !== user.id &&
        perChannel[mem.userId] != null &&
        new Date(perChannel[mem.userId]!).getTime() >= sentAt
    );
    return readers.length > 0 ? { messageId: lastOwn.id, readers } : null;
  }, [activeChannelId, user?.id, channelMessages, readState, members]);

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
    if (suppressAutoScrollRef.current) {
      suppressAutoScrollRef.current = false;
      return;
    }
    if (channelMessages.length > 0) {
      rowVirtualizer.scrollToIndex(channelMessages.length - 1, { align: "end" });
    }
  }, [channelMessages.length, rowVirtualizer]);

  // After older messages are prepended, re-anchor the viewport so the reader
  // stays on the same message (the content below the prepend is unchanged, so
  // preserving the gap-to-bottom keeps the position stable). Runs before paint.
  useLayoutEffect(() => {
    const gap = restoreBottomGapRef.current;
    if (gap == null) return;
    restoreBottomGapRef.current = null;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight - gap;
  }, [channelMessages.length]);

  const memberById = useMemo(() => {
    const map = new Map<string, MemberItem>();
    for (const m of members) map.set(m.userId, m);
    return map;
  }, [members]);

  const activeChannel = channels.find((c) => c.id === activeChannelId);

  // First unread message in the active channel, snapshotted against the
  // lastReadAt captured when the channel list was loaded (not re-fetched
  // per message, so it stays stable as a "since you last looked" boundary
  // for the whole session instead of vanishing the instant read:mark fires).
  const firstUnreadId = useMemo(() => {
    if (!activeChannel) return null;
    const boundary = activeChannel.lastReadAt ? new Date(activeChannel.lastReadAt).getTime() : 0;
    const firstNew = channelMessages.find(
      (m) => m.authorId !== user?.id && new Date(m.createdAt).getTime() > boundary
    );
    return firstNew?.id ?? null;
  }, [activeChannel, channelMessages, user?.id]);

  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Infinite scroll up: when the user nears the top, fetch the previous page
  // (cursor = oldest loaded message) and prepend it, preserving the viewport
  // by re-anchoring scrollTop after the new rows are laid out.
  async function loadOlderMessages() {
    if (!activeChannelId) return;
    if (loadingOlderRef.current) return;
    if (!hasMoreOlder[activeChannelId]) return;
    const current = messages[activeChannelId] ?? [];
    const oldest = current[0];
    if (!oldest) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const el = scrollRef.current;
    // Preserve the gap between the viewport top and the content bottom.
    restoreBottomGapRef.current = el ? el.scrollHeight - el.scrollTop : null;
    try {
      const data = await apiFetch<{ messages: MessageDto[]; nextCursor: string | null }>(
        `/channels/${activeChannelId}/messages?limit=50&cursor=${oldest.id}`
      );
      const older = [...data.messages].reverse();
      if (older.length > 0) {
        suppressAutoScrollRef.current = true;
        prependMessages(activeChannelId, older);
      } else {
        restoreBottomGapRef.current = null;
      }
      setHasMoreOlder(activeChannelId, data.messages.length >= 50);
    } catch {
      restoreBottomGapRef.current = null;
      /* pagination is best-effort */
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }

  function handleScrollList() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpToLatest(distanceFromBottom > 400);
    // Near the top → pull in older history.
    if (el.scrollTop < 160 && activeChannelId && hasMoreOlder[activeChannelId]) {
      void loadOlderMessages();
    }
  }

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

  function handlePaste(e: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
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
    if (composerRef.current) composerRef.current.style.height = "auto";
    clearDraftPersisted(activeChannelId);
    setDraftChannels((prev) => {
      const next = new Set(prev);
      next.delete(activeChannelId);
      return next;
    });
    for (const p of pending) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    setPending([]);
  }

  function handleQuote(message: MessageDto, _authorName: string) {
    const snippet = message.content.length > 200 ? `${message.content.slice(0, 200)}…` : message.content;
    const quote = snippet
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    setDraft((prev) => (prev ? `${prev}\n${quote}\n` : `${quote}\n`));
  }

  function handleForward(message: MessageDto, authorName: string) {
    setForwardMessage({ message, authorName });
  }

  async function submitForward(targetChannelId: string, comment: string) {
    if (!forwardMessage || !user) return;
    const { message, authorName } = forwardMessage;
    const quoted = message.content
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const content = `↪️ Przekazane od **${authorName}**:\n${quoted}${comment.trim() ? `\n\n${comment.trim()}` : ""}`;
    const tempId = `temp-${crypto.randomUUID()}`;
    if (targetChannelId === activeChannelId) {
      addMessage({
        id: tempId,
        channelId: targetChannelId,
        authorId: user.id,
        content,
        contentType: "text",
        parentId: null,
        editedAt: null,
        createdAt: new Date().toISOString()
      });
    }
    getSocket().emit("message:send", { channelId: targetChannelId, tempId, content, fileIds: [] });
    setForwardMessage(null);
  }

  function handleCopyLink(messageId: string) {
    if (!activeChannelId) return;
    const url = new URL(window.location.href);
    url.search = `?channel=${activeChannelId}&msg=${messageId}`;
    void navigator.clipboard.writeText(url.toString());
    showToast("Skopiowano link do wiadomości");
  }

  async function submitSchedule(sendAtIso: string) {
    if (!activeChannelId || !draft.trim()) return;
    await apiFetch(`/channels/${activeChannelId}/schedule`, {
      method: "POST",
      body: JSON.stringify({ content: draft.trim(), sendAt: sendAtIso })
    });
    setDraft("");
    clearDraftPersisted(activeChannelId);
    setShowSchedulePicker(false);
    showToast("Wiadomość zaplanowana ⏰");
  }

  async function submitPoll(question: string, options: string[], allowMultiple: boolean) {
    if (!activeChannelId) return;
    await apiFetch(`/channels/${activeChannelId}/polls`, {
      method: "POST",
      body: JSON.stringify({ question, options, allowMultiple })
    });
    setShowPollModal(false);
  }

  async function submitReminder(remindAt: string) {
    if (!reminderMessageId) return;
    await apiFetch("/reminders", {
      method: "POST",
      body: JSON.stringify({ messageId: reminderMessageId, remindAt })
    });
    setReminderMessageId(null);
    showToast("Przypomnienie ustawione 🔔");
  }

  // ── permalink navigation: ?channel=X&msg=Y jumps straight to a message ──
  useEffect(() => {
    if (permalinkHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const targetChannel = params.get("channel");
    const targetMsg = params.get("msg");
    if (!targetChannel || !targetMsg || channels.length === 0) return;
    permalinkHandled.current = true;
    permalinkInProgressRef.current = targetChannel;

    setActiveChannel(targetChannel);
    void apiFetch<{ messages: MessageDto[]; targetId: string }>(
      `/channels/${targetChannel}/messages/around/${targetMsg}`
    ).then((data) => {
      suppressAutoScrollRef.current = true;
      setMessages(targetChannel, data.messages);
      setHighlightedMessageId(data.targetId);
      setTimeout(() => {
        const el = document.getElementById(`message-${data.targetId}`);
        el?.scrollIntoView({ block: "center" });
      }, 100);
      setTimeout(() => setHighlightedMessageId(null), 2500);
      permalinkInProgressRef.current = null;
      // Clean the URL so a refresh doesn't re-jump.
      window.history.replaceState({}, "", window.location.pathname);
    });
  }, [channels, setActiveChannel, setMessages]);

  function handleDraftChange(value: string) {
    setDraft(value);
    if (activeChannelId) {
      setDraftPersisted(activeChannelId, value);
      setDraftChannels((prev) => {
        const next = new Set(prev);
        if (value.trim()) next.add(activeChannelId);
        else next.delete(activeChannelId);
        return next;
      });
    }
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

  // Wrap the current textarea selection with markdown markers (bold/italic/etc.).
  // If nothing is selected, inserts the markers with a placeholder and selects it.
  function applyMarkdown(before: string, after: string = before, placeholder = "") {
    const el = composerRef.current;
    if (!el) return;
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const selected = draft.slice(start, end) || placeholder;
    const next = draft.slice(0, start) + before + selected + after + draft.slice(end);
    handleDraftChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const selStart = start + before.length;
      el.setSelectionRange(selStart, selStart + selected.length);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
    });
  }

  // Insert an emoji at the current caret position in the composer.
  function insertEmoji(emoji: string) {
    const el = composerRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + emoji + draft.slice(end);
    handleDraftChange(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = start + emoji.length;
      el.setSelectionRange(caret, caret);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
    });
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
    const parsed = parseSearchFilters(term);
    if (parsed.text.length < 2 && !parsed.fromToken && !parsed.inToken && !parsed.hasFile && !parsed.before && !parsed.after) {
      setSearchResults(null);
      return;
    }
    if (!activeOrgId) return;

    const params = new URLSearchParams({ orgId: activeOrgId });
    if (parsed.text.length >= 2) params.set("q", parsed.text);
    if (parsed.fromToken) {
      const match = members.find((m) => m.displayName.toLowerCase().includes(parsed.fromToken!.toLowerCase()));
      if (match) params.set("fromUserId", match.userId);
    }
    if (parsed.inToken) {
      const match = channels.find((c) => (c.name ?? "").toLowerCase().includes(parsed.inToken!.toLowerCase()));
      if (match) params.set("channelId", match.id);
    }
    if (parsed.hasFile) params.set("hasFile", "true");
    if (parsed.before) params.set("before", new Date(parsed.before).toISOString());
    if (parsed.after) params.set("after", new Date(parsed.after).toISOString());

    const data = await apiFetch<{ results: SearchResult[] }>(`/search?${params.toString()}`);
    setSearchResults(data.results);
  }

  function handleSearchInput(value: string) {
    setSearchTerm(value);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    const parsed = parseSearchFilters(value);
    if (parsed.text.trim().length < 2 && !parsed.fromToken && !parsed.inToken && !parsed.hasFile && !parsed.before && !parsed.after) {
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
    <div className="flex h-full gap-0 p-0 md:gap-3 md:p-3">
      {wsDisconnected && (
        <div className="fixed left-1/2 top-2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--warning)]/90 px-4 py-1.5 text-xs font-medium text-black shadow-lg">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-black/60" />
          Utracono połączenie — łączenie ponownie…
        </div>
      )}
      {showMobileSidebar && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setShowMobileSidebar(false)}
        />
      )}
      <aside
        onClickCapture={() => {
          if (window.innerWidth < 768) setShowMobileSidebar(false);
        }}
        className={`mobile-drawer glass flex w-[82%] max-w-xs shrink-0 flex-col overflow-hidden max-md:!rounded-none max-md:!border-y-0 max-md:!border-l-0 md:static md:z-auto md:w-64 ${
          showMobileSidebar ? "mobile-drawer--open" : ""
        }`}
      >
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] p-4">
          <span className="font-semibold">
            {orgs.find((o) => o.id === activeOrgId)?.name ?? "chatv2"}
          </span>
          <div className="flex items-center gap-1">
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
          <button
            onClick={() => setShowSaved((v) => !v)}
            className={`mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-150 ${
              showSaved
                ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                : "text-[var(--text)] hover:bg-[var(--border)]/50"
            }`}
          >
            <Icon icon={Bookmark} size={15} /> Zapisane {savedIds.size > 0 && `(${savedIds.size})`}
          </button>

          {channels.some((c) => c.favorite) && (
            <SidebarSection id="favorites" title="Ulubione">
              {channels
                .filter((c) => c.favorite)
                .map((c) => (
                  <button
                    key={`fav-${c.id}`}
                    onClick={() => setActiveChannel(c.id)}
                    className={`nav-item flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-all duration-150 ${
                      c.id === activeChannelId
                        ? "bg-[var(--accent)]/15 text-[var(--accent)] shadow-[inset_0_0_0_1px_rgba(91,124,255,0.25)]"
                        : "text-[var(--text)] hover:bg-[var(--border)]/50"
                    }`}
                  >
                    <span>
                      {c.type === "DM" ? "@" : c.type === "PRIVATE" ? "🔒" : "#"} {c.name}
                    </span>
                    {(c.unreadCount ?? 0) > 0 && !c.muted && (
                      <span className="animate-spring-in ml-2 min-w-5 rounded-full bg-[var(--accent)] px-1.5 text-center text-xs font-semibold text-white">
                        {c.unreadCount}
                      </span>
                    )}
                  </button>
                ))}
            </SidebarSection>
          )}

          <SidebarSection
            id="channels"
            title="Kanały"
            action={
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowBrowseChannels(true)}
                  title="Przeglądaj kanały publiczne"
                  className="text-xs text-[var(--text-dim)] hover:text-[var(--accent)]"
                >
                  Przeglądaj
                </button>
                <button
                  onClick={() => setShowCreateChannel(true)}
                  title="Utwórz kanał"
                  className="text-xs text-[var(--text-dim)] hover:text-[var(--accent)]"
                >
                  <Icon icon={Plus} size={14} />
                </button>
              </div>
            }
          >
            {channels
              .filter((c) => c.type !== "DM")
              .map((c) => (
                <button
                  key={c.id}
                  draggable
                  onDragStart={(e) => {
                    setDraggedChannelId(c.id);
                    e.dataTransfer.effectAllowed = "move";
                    // Source of truth for the drop handler — reading via
                    // dataTransfer (not React state) avoids any risk of a
                    // stale closure if drop fires before a re-render.
                    e.dataTransfer.setData("text/chatv2-channel-id", c.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const sourceId = e.dataTransfer.getData("text/chatv2-channel-id");
                    if (sourceId) moveNonDmChannel(sourceId, c.id);
                    setDraggedChannelId(null);
                  }}
                  onDragEnd={() => setDraggedChannelId(null)}
                  onClick={() => setActiveChannel(c.id)}
                  title="Przeciągnij, aby zmienić kolejność"
                  className={`nav-item flex w-full cursor-grab items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-all duration-150 active:cursor-grabbing ${
                    draggedChannelId === c.id ? "opacity-40" : ""
                  } ${
                    c.id === activeChannelId
                      ? "bg-[var(--accent)]/15 text-[var(--accent)] shadow-[inset_0_0_0_1px_rgba(91,124,255,0.25)]"
                      : c.muted
                        ? "text-[var(--text-dim)] hover:bg-[var(--border)]/50"
                        : "text-[var(--text)] hover:bg-[var(--border)]/50"
                  }`}
                >
                  <span className="flex items-center gap-1">
                    {c.type === "PRIVATE" ? "🔒" : "#"} {c.name} {c.muted && <Icon icon={BellOff} size={12} />}
                    {draftChannels.has(c.id) && (
                      <span className="text-[10px] italic text-[var(--text-dim)]">(szkic)</span>
                    )}
                  </span>
                  {(c.unreadCount ?? 0) > 0 && !c.muted && (
                    <span className="animate-spring-in ml-2 min-w-5 rounded-full bg-[var(--accent)] px-1.5 text-center text-xs font-semibold text-white">
                      {c.unreadCount}
                    </span>
                  )}
                </button>
              ))}
          </SidebarSection>

          <SidebarSection
            id="dms"
            title="Wiadomości bezpośrednie"
            action={
              <button
                onClick={() => setShowGroupDmPicker(true)}
                title="Nowa grupa"
                className="text-xs text-[var(--text-dim)] hover:text-[var(--accent)]"
              >
                + Grupa
              </button>
            }
          >
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
                  <span>
                    @ {c.name} {c.muted && <Icon icon={BellOff} size={12} />}
                  </span>
                  {(c.unreadCount ?? 0) > 0 && !c.muted && (
                    <span className="animate-spring-in ml-2 min-w-5 rounded-full bg-[var(--accent)] px-1.5 text-center text-xs font-semibold text-white">
                      {c.unreadCount}
                    </span>
                  )}
                </button>
              ))}
          </SidebarSection>

          <SidebarSection id="team" title="Zespół">
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
          </SidebarSection>
        </div>

        <div className="border-t border-[var(--glass-border)] p-2">
          <UserStatusControl
            userId={user?.id ?? ""}
            displayName={user?.displayName ?? "—"}
            avatarUrl={user ? avatarUrls[user.id] : null}
            myPresenceDotClass={presenceDotClass(user ? presenceStatus[user.id] : undefined) || "bg-[var(--accent-2)]"}
          />
          <div className="mt-1 flex items-center justify-end gap-3 px-1.5">
            {user?.isSuperAdmin && (
              <Link
                to="/super-admin"
                title="Panel super-admina"
                className="text-xs text-[var(--warning)] transition-colors hover:opacity-80"
              >
                Super-admin
              </Link>
            )}
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
      </aside>

      <main className="glass flex min-w-0 flex-1 flex-col overflow-hidden max-md:!rounded-none max-md:!border-0 max-md:!shadow-none">
        {activeChannel ? (
          <>
            <header className="flex items-center justify-between gap-4 border-b border-[var(--glass-border)] px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setShowMobileSidebar(true)}
                    title="Menu"
                    className="-ml-1 p-1 text-[var(--text-dim)] hover:text-[var(--text)] md:hidden"
                  >
                    <Icon icon={Menu} size={22} />
                  </button>
                  <h1 className="truncate text-base font-semibold md:text-sm">
                    {activeChannel.type === "DM" ? "@" : activeChannel.type === "PRIVATE" ? "🔒" : "#"}{" "}
                    {activeChannel.name}
                  </h1>

                  {/* Desktop: channel actions inline. */}
                  <div className="hidden items-center gap-1.5 md:flex">
                    <button
                      onClick={() => toggleFavorite(activeChannel.id, !activeChannel.favorite)}
                      title={activeChannel.favorite ? "Usuń z ulubionych" : "Dodaj do ulubionych"}
                      className={activeChannel.favorite ? "text-[var(--warning)]" : "text-[var(--text-dim)] hover:text-[var(--warning)]"}
                    >
                      <Icon icon={Star} className={activeChannel.favorite ? "fill-current" : ""} />
                    </button>
                    <button
                      onClick={() => toggleMute(activeChannel.id, !activeChannel.muted)}
                      title={activeChannel.muted ? "Wyłącz wyciszenie" : "Wycisz kanał"}
                      className="text-[var(--text-dim)] hover:text-[var(--text)]"
                    >
                      <Icon icon={activeChannel.muted ? BellOff : Bell} size={15} />
                    </button>
                    {activeChannel.type !== "DM" && (
                      <button
                        onClick={() => setShowMembersPanel(true)}
                        title="Członkowie kanału"
                        className="text-[var(--text-dim)] hover:text-[var(--text)]"
                      >
                        <Icon icon={Users} size={15} />
                      </button>
                    )}
                    {aiEnabled && (
                      <button
                        onClick={() => void runAiSummary()}
                        disabled={aiSummaryLoading}
                        title="Podsumuj czego nie przeczytałeś (AI)"
                        className="text-[var(--text-dim)] hover:text-[var(--accent)] disabled:opacity-40"
                      >
                        <Icon icon={Sparkles} size={15} />
                      </button>
                    )}
                    {activeChannel.type !== "DM" && (
                      <button
                        onClick={() => setInVoiceChannelId((prev) => (prev === activeChannel.id ? null : activeChannel.id))}
                        title={inVoiceChannelId === activeChannel.id ? "W rozmowie głosowej" : "Dołącz do rozmowy głosowej"}
                        className={inVoiceChannelId === activeChannel.id ? "text-[var(--accent)]" : "text-[var(--text-dim)] hover:text-[var(--accent)]"}
                      >
                        <Icon icon={Mic} size={15} />
                      </button>
                    )}
                  </div>

                  {/* Mobile: fold channel actions into a "⋯" menu. */}
                  <div className="relative md:hidden">
                    <button
                      onClick={() => setShowChannelMenu((v) => !v)}
                      title="Akcje kanału"
                      className="p-1 text-[var(--text-dim)] hover:text-[var(--text)]"
                    >
                      <Icon icon={MoreVertical} size={20} />
                    </button>
                    {showChannelMenu && (
                      <div className="animate-slide-up absolute left-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-strong)] py-1 shadow-xl backdrop-blur-lg">
                        <button
                          onClick={() => {
                            setShowChannelMenu(false);
                            toggleFavorite(activeChannel.id, !activeChannel.favorite);
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                        >
                          <Icon icon={Star} size={16} className={activeChannel.favorite ? "fill-current text-[var(--warning)]" : ""} />
                          {activeChannel.favorite ? "Usuń z ulubionych" : "Dodaj do ulubionych"}
                        </button>
                        <button
                          onClick={() => {
                            setShowChannelMenu(false);
                            toggleMute(activeChannel.id, !activeChannel.muted);
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                        >
                          <Icon icon={activeChannel.muted ? BellOff : Bell} size={16} />
                          {activeChannel.muted ? "Wyłącz wyciszenie" : "Wycisz kanał"}
                        </button>
                        {activeChannel.type !== "DM" && (
                          <button
                            onClick={() => {
                              setShowChannelMenu(false);
                              setShowMembersPanel(true);
                            }}
                            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                          >
                            <Icon icon={Users} size={16} /> Członkowie kanału
                          </button>
                        )}
                        {aiEnabled && (
                          <button
                            onClick={() => {
                              setShowChannelMenu(false);
                              void runAiSummary();
                            }}
                            disabled={aiSummaryLoading}
                            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--accent)]/15 disabled:opacity-40"
                          >
                            <Icon icon={Sparkles} size={16} /> Podsumuj kanał (AI)
                          </button>
                        )}
                        {activeChannel.type !== "DM" && (
                          <button
                            onClick={() => {
                              setShowChannelMenu(false);
                              setInVoiceChannelId((prev) => (prev === activeChannel.id ? null : activeChannel.id));
                            }}
                            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                          >
                            <Icon icon={Mic} size={16} />
                            {inVoiceChannelId === activeChannel.id ? "Opuść rozmowę głosową" : "Dołącz do rozmowy głosowej"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {editingTopic ? (
                  <div className="mt-0.5 flex items-center gap-1">
                    <input
                      autoFocus
                      value={topicDraft}
                      onChange={(e) => setTopicDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveTopic();
                        if (e.key === "Escape") setEditingTopic(false);
                      }}
                      placeholder="Ustaw temat kanału…"
                      maxLength={250}
                      className="w-72 rounded border border-[var(--glass-border)] bg-[var(--glass)] px-1.5 py-0.5 text-xs outline-none"
                    />
                    <button onClick={saveTopic} className="text-xs text-[var(--accent)]">
                      Zapisz
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      if (activeChannel.myRole !== "ADMIN") return;
                      setTopicDraft(activeChannel.topic ?? "");
                      setEditingTopic(true);
                    }}
                    className={`truncate text-left text-xs text-[var(--text-dim)] ${activeChannel.myRole === "ADMIN" ? "hover:text-[var(--text)]" : ""}`}
                  >
                    {activeChannel.topic || (activeChannel.myRole === "ADMIN" ? "+ Dodaj temat kanału" : "")}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {pinnedMessages.length > 0 && (
                  <button
                    onClick={() => setShowPinnedList((v) => !v)}
                    className="rounded-full border border-[var(--glass-border)] bg-[var(--glass)] px-2.5 py-1 text-xs text-[var(--text-dim)] transition-colors hover:bg-[var(--border)]/40"
                  >
                    <Icon icon={Pin} size={12} /> {pinnedMessages.length}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowMobileSearch((v) => !v)}
                  title="Szukaj"
                  className="text-[var(--text-dim)] hover:text-[var(--text)] md:hidden"
                >
                  <Icon icon={Search} size={18} />
                </button>
                <form onSubmit={handleSearch} className="relative hidden md:block">
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={searchTerm}
                    onChange={(e) => handleSearchInput(e.target.value)}
                    placeholder="Szukaj (Ctrl+K)… from: in: has:file"
                    className="w-56 rounded-full border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-1.5 text-xs outline-none backdrop-blur-sm transition-shadow focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </form>
              </div>
            </header>

            {showMobileSearch && (
              <form
                onSubmit={handleSearch}
                className="animate-slide-up flex items-center gap-2 border-b border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 backdrop-blur-sm md:hidden"
              >
                <input
                  type="search"
                  autoFocus
                  value={searchTerm}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  placeholder="Szukaj… from: in: has:file"
                  className="flex-1 rounded-full border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowMobileSearch(false);
                    setSearchResults(null);
                  }}
                  className="text-[var(--text-dim)] hover:text-[var(--text)]"
                >
                  <Icon icon={X} size={18} />
                </button>
              </form>
            )}

            {showPinnedList && pinnedMessages.length > 0 && (
              <div className="animate-slide-up max-h-48 space-y-2 overflow-y-auto border-b border-[var(--glass-border)] bg-[var(--glass)] px-4 py-2 backdrop-blur-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--text-dim)]">
                    Przypięte wiadomości ({pinnedMessages.length})
                  </span>
                  <button
                    onClick={() => setShowPinnedList(false)}
                    className="text-xs text-[var(--text-dim)] transition-colors hover:text-[var(--text)]"
                  >
                    <Icon icon={X} size={13} />
                  </button>
                </div>
                {pinnedMessages.map((pm) => (
                  <div key={pm.id} className="rounded-lg bg-[var(--border)]/30 px-2 py-1.5 text-sm">
                    <span className="font-medium">
                      {members.find((m) => m.userId === pm.authorId)?.displayName ?? "Nieznany"}:
                    </span>{" "}
                    {pm.content || <em className="text-[var(--text-dim)]">(wiadomość usunięta)</em>}
                  </div>
                ))}
              </div>
            )}

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
              onScroll={handleScrollList}
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
              {channelMessages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <span className="text-4xl">
                    {activeChannel.type === "DM" ? "👋" : "✨"}
                  </span>
                  <p className="text-sm font-medium">
                    {activeChannel.type === "DM"
                      ? `To początek rozmowy z ${activeChannel.name}`
                      : `Witaj na #${activeChannel.name}!`}
                  </p>
                  <p className="max-w-xs text-xs text-[var(--text-dim)]">
                    Napisz pierwszą wiadomość poniżej. Możesz też przeciągnąć plik, wkleić obrazek,
                    utworzyć ankietę (+) albo wspomnieć kogoś przez @.
                  </p>
                </div>
              )}
              {loadingOlder && (
                <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center">
                  <span className="glass-strong flex items-center gap-2 rounded-full px-3 py-1 text-xs text-[var(--text-dim)] shadow-lg">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
                    Ładowanie starszych wiadomości…
                  </span>
                </div>
              )}
              {showJumpToLatest && (
                <button
                  onClick={() => {
                    rowVirtualizer.scrollToIndex(channelMessages.length - 1, { align: "end" });
                    setShowJumpToLatest(false);
                  }}
                  className="animate-spring-in glass-strong sticky top-2 z-20 float-right flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-[var(--accent)] shadow-lg"
                >
                  ↓ Najnowsze
                </button>
              )}
              <div
                style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const m = channelMessages[virtualRow.index]!;
                  const prev = channelMessages[virtualRow.index - 1];
                  // Day divider when the calendar day changes (or at the very
                  // top of the history) so messages jumping e.g. 17:22 -> 10:45
                  // are clearly attributed to their day.
                  const newDay =
                    !prev || !isSameDay(new Date(prev.createdAt), new Date(m.createdAt));
                  const grouped =
                    !newDay &&
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
                      {newDay && (
                        <div className="my-2 flex items-center gap-3 px-1 select-none">
                          <span className="h-px flex-1 bg-[var(--glass-border)]" />
                          <span className="rounded-full border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-0.5 text-[11px] font-medium text-[var(--text-dim)]">
                            {formatDayLabel(new Date(m.createdAt))}
                          </span>
                          <span className="h-px flex-1 bg-[var(--glass-border)]" />
                        </div>
                      )}
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
                        onToggleSave={handleToggleSave}
                        onTogglePin={handleTogglePin}
                        onQuote={handleQuote}
                        onForward={handleForward}
                        onCopyLink={handleCopyLink}
                        onRemind={setReminderMessageId}
                        highlighted={m.id === highlightedMessageId}
                        canPin={activeChannel?.myRole === "ADMIN"}
                        isSaved={savedIds.has(m.id)}
                        isFirstUnread={m.id === firstUnreadId}
                        autoEditNonce={editRequest?.id === m.id ? editRequest.nonce : 0}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex h-5 items-center gap-1.5 px-4 text-xs text-[var(--text-dim)]">
              {typingNames.length > 0 ? (
                <>
                  <span className="flex gap-0.5">
                    <span className="typing-dot h-1 w-1 rounded-full bg-[var(--text-dim)]" />
                    <span className="typing-dot h-1 w-1 rounded-full bg-[var(--text-dim)]" />
                    <span className="typing-dot h-1 w-1 rounded-full bg-[var(--text-dim)]" />
                  </span>
                  {typingNames.join(", ")} pisze...
                </>
              ) : readReceipt ? (
                <span className="flex items-center gap-1.5" title={`Przeczytane przez: ${readReceipt.readers.map((r) => r.displayName).join(", ")}`}>
                  <span>Przeczytane</span>
                  <span className="flex -space-x-1.5">
                    {readReceipt.readers.slice(0, 5).map((r) => (
                      <Avatar
                        key={r.userId}
                        userId={r.userId}
                        displayName={r.displayName}
                        url={avatarUrls[r.userId]}
                        size={16}
                        className="ring-1 ring-[var(--bg)]"
                      />
                    ))}
                  </span>
                  {readReceipt.readers.length > 5 && <span>+{readReceipt.readers.length - 5}</span>}
                </span>
              ) : null}
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
                        <Icon icon={X} size={13} />
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

                {/* Mobile: collapse secondary composer actions into a single "+" menu
                    so the text input keeps most of the width on narrow screens. */}
                <div className="relative md:hidden">
                  <button
                    type="button"
                    onClick={() => setShowComposerActions((v) => !v)}
                    title="Więcej akcji"
                    className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 transition-all duration-150 hover:bg-[var(--border)]/40 active:scale-[0.96]"
                  >
                    <Icon icon={Plus} />
                  </button>
                  {showComposerActions && (
                    <div className="animate-slide-up absolute bottom-full left-0 z-20 mb-1 w-52 overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-strong)] py-1 shadow-xl backdrop-blur-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setShowComposerActions(false);
                          setShowComposerEmoji(true);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                      >
                        <Icon icon={Smile} size={16} /> Emoji
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowComposerActions(false);
                          fileInputRef.current?.click();
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                      >
                        <Icon icon={Paperclip} size={16} /> Załącz plik
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowComposerActions(false);
                          setShowPollModal(true);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                      >
                        <Icon icon={BarChart3} size={16} /> Utwórz ankietę
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowComposerActions(false);
                          setShowSchedulePicker(true);
                        }}
                        disabled={!draft.trim()}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent)]/15 disabled:opacity-40"
                      >
                        <Icon icon={Clock} size={16} /> Wyślij później
                      </button>
                      {aiEnabled &&
                        [
                          { mode: "improve", label: "AI: Popraw ton" },
                          { mode: "shorten", label: "AI: Skróć" },
                          { mode: "translate_en", label: "AI: Przetłumacz na EN" },
                          { mode: "translate_pl", label: "AI: Przetłumacz na PL" },
                          { mode: "corpo", label: "AI: 🤵 Korpo-mowa" },
                          { mode: "corpo_hard", label: "AI: 🤡 Korpo-mowa (hard)" }
                        ].map((opt) => (
                          <button
                            key={opt.mode}
                            type="button"
                            onClick={() => {
                              setShowComposerActions(false);
                              void runAiRewrite(opt.mode);
                            }}
                            disabled={!draft.trim() || aiRewriteLoading}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent)]/15 disabled:opacity-40"
                          >
                            <Icon icon={Sparkles} size={16} /> {opt.label}
                          </button>
                        ))}
                    </div>
                  )}
                  {/* Mobile emoji picker (opened from the "+" menu). */}
                  {showComposerEmoji && (
                    <div className="md:hidden">
                      <EmojiPicker
                        onPick={(emoji) => insertEmoji(emoji)}
                        onClose={() => setShowComposerEmoji(false)}
                      />
                    </div>
                  )}
                </div>

                {/* Desktop: secondary actions live in a single designed dropdown
                    to keep the composer bar uncluttered as features grow. */}
                <div className="relative hidden items-center gap-2 md:flex">
                  <button
                    type="button"
                    onClick={() => setShowComposerMenu((v) => !v)}
                    title="Formatowanie i załączniki"
                    className={`rounded-xl border border-[var(--glass-border)] px-3 py-2 transition-all duration-150 hover:bg-[var(--border)]/40 active:scale-[0.96] ${
                      showComposerMenu ? "bg-[var(--accent)]/20" : "bg-[var(--glass)]"
                    }`}
                  >
                    <Icon icon={Plus} />
                  </button>
                  {showComposerMenu && (
                    <>
                      {/* Click-away backdrop */}
                      <div className="fixed inset-0 z-10" onClick={() => setShowComposerMenu(false)} />
                      <div className="animate-slide-up absolute bottom-full left-0 z-20 mb-2 w-60 overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-strong)] shadow-2xl backdrop-blur-lg">
                        <div className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">
                          Formatowanie
                        </div>
                        <div className="flex items-center gap-1 px-2 pb-2">
                          {[
                            { icon: Bold, title: "Pogrubienie (Ctrl+B)", act: () => applyMarkdown("**", "**", "pogrubienie") },
                            { icon: Italic, title: "Kursywa (Ctrl+I)", act: () => applyMarkdown("_", "_", "kursywa") },
                            { icon: Strikethrough, title: "Przekreślenie", act: () => applyMarkdown("~~", "~~", "przekreślenie") },
                            { icon: Code, title: "Kod (Ctrl+E)", act: () => applyMarkdown("`", "`", "kod") },
                            { icon: Link2, title: "Link", act: () => applyMarkdown("[", "](url)", "tekst") }
                          ].map((f, i) => (
                            <button
                              key={i}
                              type="button"
                              title={f.title}
                              onClick={() => f.act()}
                              className="flex-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] py-1.5 transition-colors hover:bg-[var(--accent)]/20 active:scale-[0.94]"
                            >
                              <Icon icon={f.icon} size={15} />
                            </button>
                          ))}
                        </div>
                        <div className="border-t border-[var(--glass-border)]" />
                        <button
                          type="button"
                          onClick={() => {
                            setShowComposerMenu(false);
                            setShowComposerEmoji(true);
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                        >
                          <Icon icon={Smile} size={16} /> Emoji
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowComposerMenu(false);
                            fileInputRef.current?.click();
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                        >
                          <Icon icon={Paperclip} size={16} /> Załącz plik
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowComposerMenu(false);
                            setShowPollModal(true);
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                        >
                          <Icon icon={BarChart3} size={16} /> Utwórz ankietę
                        </button>
                        <button
                          type="button"
                          disabled={!draft.trim()}
                          onClick={() => {
                            setShowComposerMenu(false);
                            setShowSchedulePicker(true);
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent)]/15 disabled:opacity-40"
                        >
                          <Icon icon={Clock} size={16} /> Wyślij później
                        </button>
                      </div>
                    </>
                  )}
                  {showComposerEmoji && (
                    <EmojiPicker
                      onPick={(emoji) => insertEmoji(emoji)}
                      onClose={() => setShowComposerEmoji(false)}
                    />
                  )}
                  {aiEnabled && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowAiRewriteMenu((v) => !v)}
                        disabled={!draft.trim() || aiRewriteLoading}
                        title="AI: przeredaguj tekst"
                        className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 transition-all duration-150 hover:bg-[var(--border)]/40 active:scale-[0.96] disabled:opacity-40"
                      >
                        <Icon icon={Sparkles} />
                      </button>
                      {showAiRewriteMenu && (
                        <div className="animate-slide-up absolute bottom-full left-0 z-20 mb-1 w-48 overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-strong)] py-1 shadow-xl backdrop-blur-lg">
                          {[
                            { mode: "improve", label: "Popraw ton" },
                            { mode: "shorten", label: "Skróć" },
                            { mode: "translate_en", label: "Przetłumacz na EN" },
                            { mode: "translate_pl", label: "Przetłumacz na PL" },
                            { mode: "corpo", label: "🤵 Korpo-mowa" },
                            { mode: "corpo_hard", label: "🤡 Korpo-mowa (hard)" }
                          ].map((opt) => (
                            <button
                              key={opt.mode}
                              type="button"
                              onClick={() => void runAiRewrite(opt.mode)}
                              className="block w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <textarea
                  ref={composerRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => {
                    handleDraftChange(e.target.value);
                    // Auto-grow up to ~6 lines, then scroll inside.
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 144)}px`;
                  }}
                  onKeyDown={(e) => {
                    // Markdown formatting shortcuts (F6-C).
                    if (e.ctrlKey || e.metaKey) {
                      const k = e.key.toLowerCase();
                      if (k === "b") {
                        e.preventDefault();
                        applyMarkdown("**", "**", "pogrubienie");
                        return;
                      }
                      if (k === "i") {
                        e.preventDefault();
                        applyMarkdown("_", "_", "kursywa");
                        return;
                      }
                      if (k === "e") {
                        e.preventDefault();
                        applyMarkdown("`", "`", "kod");
                        return;
                      }
                    }
                    // Enter = send, Shift+Enter = newline (F6-C.3).
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                      e.currentTarget.style.height = "auto";
                    }
                    // ↑ in an empty composer edits your last message.
                    if (
                      e.key === "ArrowUp" &&
                      !e.shiftKey &&
                      !e.ctrlKey &&
                      !e.metaKey &&
                      draft.length === 0
                    ) {
                      const own = [...channelMessages]
                        .reverse()
                        .find(
                          (msg) =>
                            msg.authorId === user?.id &&
                            msg.contentType === "text" &&
                            !!msg.content &&
                            !msg.id.startsWith("temp-")
                        );
                      if (own) {
                        e.preventDefault();
                        const idx = channelMessages.findIndex((msg) => msg.id === own.id);
                        if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: "center" });
                        setEditRequest((prev) => ({ id: own.id, nonce: (prev?.nonce ?? 0) + 1 }));
                        // Clear the signal shortly after so scrolling the row
                        // out and back in doesn't re-open the editor.
                        window.setTimeout(() => setEditRequest(null), 1500);
                      }
                    }
                  }}
                  onPaste={handlePaste}
                  placeholder={`Napisz na ${activeChannel.type === "DM" ? "@" : "#"}${activeChannel.name}`}
                  maxLength={8000}
                  className="min-w-0 flex-1 resize-none rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 text-sm leading-snug outline-none backdrop-blur-sm transition-shadow focus:ring-2 focus:ring-[var(--accent)]"
                />
                {draft.length > 7000 && (
                  <span className="absolute -top-5 right-24 text-xs text-[var(--warning)]">
                    {draft.length}/8000
                  </span>
                )}
                <button
                  type="submit"
                  disabled={!draft.trim() && pending.length === 0}
                  title="Wyślij"
                  className="flex items-center justify-center rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white shadow-[0_4px_16px_rgba(91,124,255,0.35)] transition-all duration-150 hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 sm:px-4"
                >
                  <Icon icon={Send} className="sm:hidden" />
                  <span className="hidden sm:inline">Wyślij</span>
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex flex-1 flex-col">
            <div className="p-4 md:hidden">
              <button
                onClick={() => setShowMobileSidebar(true)}
                title="Menu"
                className="text-[var(--text-dim)] hover:text-[var(--text)]"
              >
                <Icon icon={Menu} size={18} />
              </button>
            </div>
            <div className="flex flex-1 items-center justify-center text-[var(--text-dim)]">
              <p className="text-sm">Wybierz kanał, aby rozpocząć rozmowę</p>
            </div>
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

      {showSaved && user && (
        <SavedPanel
          currentUserId={user.id}
          members={members}
          onClose={() => setShowSaved(false)}
          onToggleSave={handleToggleSave}
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

      {forwardMessage && (
        <ForwardPicker
          channels={channels}
          onClose={() => setForwardMessage(null)}
          onSubmit={(channelId, comment) => void submitForward(channelId, comment)}
        />
      )}

      {showMembersPanel && activeChannelId && (
        <ChannelMembersPanel
          channelId={activeChannelId}
          channelName={activeChannel?.name ?? null}
          isDm={activeChannel?.type === "DM"}
          isAdmin={activeChannel?.myRole === "ADMIN"}
          orgMembers={members}
          onClose={() => setShowMembersPanel(false)}
          onRenamed={(name) => setChannels(channels.map((c) => (c.id === activeChannelId ? { ...c, name } : c)))}
          onArchived={() => setChannels(channels.filter((c) => c.id !== activeChannelId))}
        />
      )}

      {showGroupDmPicker && (
        <GroupDmPicker
          members={members.filter((m) => m.userId !== user?.id)}
          selection={groupDmSelection}
          onToggle={(userId) =>
            setGroupDmSelection((prev) => {
              const next = new Set(prev);
              next.has(userId) ? next.delete(userId) : next.add(userId);
              return next;
            })
          }
          onClose={() => {
            setShowGroupDmPicker(false);
            setGroupDmSelection(new Set());
          }}
          onSubmit={() => void createGroupDm()}
        />
      )}

      {digestToast && (
        <div className="animate-toast-in glass-strong fixed bottom-6 left-1/2 z-50 -translate-x-1/2 px-4 py-2.5 text-sm shadow-xl">
          {digestToast}
        </div>
      )}

      {showQuickSwitcher && (
        <QuickSwitcher
          channels={channels}
          members={members}
          onSelectChannel={(channelId) => {
            setActiveChannel(channelId);
            setShowQuickSwitcher(false);
          }}
          onSelectMember={(userId) => {
            void handleStartDm(userId);
            setShowQuickSwitcher(false);
          }}
          onClose={() => setShowQuickSwitcher(false)}
        />
      )}

      {showSchedulePicker && (
        <SchedulePicker onClose={() => setShowSchedulePicker(false)} onSubmit={(iso) => void submitSchedule(iso)} />
      )}

      {showPollModal && (
        <CreatePollModal
          onClose={() => setShowPollModal(false)}
          onSubmit={(q, opts, multi) => void submitPoll(q, opts, multi)}
        />
      )}

      {reminderMessageId && (
        <ReminderPicker
          onClose={() => setReminderMessageId(null)}
          onSubmit={(iso) => void submitReminder(iso)}
        />
      )}

      {(aiSummaryLoading || aiSummary) &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAiSummary(null)}>
            <div
              className="glass-strong max-h-[70vh] w-full max-w-md overflow-y-auto rounded-2xl p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center gap-2">
                <Icon icon={Sparkles} size={16} className="text-[var(--accent)]" />
                <h2 className="text-sm font-semibold">Podsumowanie AI</h2>
              </div>
              {aiSummaryLoading ? (
                <p className="text-sm text-[var(--text-dim)]">Generowanie podsumowania…</p>
              ) : (
                <div className="whitespace-pre-line text-sm">{aiSummary}</div>
              )}
              <p className="mt-4 text-xs text-[var(--text-dim)]">
                Treść wygenerowana przez darmowy model AI — może zawierać nieścisłości.
              </p>
              <button onClick={() => setAiSummary(null)} className={`${glassButtonGhost} mt-3 w-full`}>
                Zamknij
              </button>
            </div>
          </div>,
          document.body
        )}

      {showCreateChannel && activeOrgId && (
        <CreateChannelModal
          orgId={activeOrgId}
          onClose={() => setShowCreateChannel(false)}
          onCreated={(channelId) => {
            setShowCreateChannel(false);
            void apiFetch<ChannelItem[]>(`/orgs/${activeOrgId}/channels`).then((data) => {
              setChannels(data);
              setActiveChannel(channelId);
            });
          }}
        />
      )}

      {showBrowseChannels && activeOrgId && (
        <BrowseChannelsModal
          orgId={activeOrgId}
          onClose={() => setShowBrowseChannels(false)}
          onJoined={(channelId) => {
            void apiFetch<ChannelItem[]>(`/orgs/${activeOrgId}/channels`).then((data) => {
              setChannels(data);
              setActiveChannel(channelId);
            });
          }}
        />
      )}

      {inVoiceChannelId && user && (
        <VoiceRoom
          channelId={inVoiceChannelId}
          channelName={channels.find((c) => c.id === inVoiceChannelId)?.name ?? ""}
          myUserId={user.id}
          members={members}
          onClose={() => setInVoiceChannelId(null)}
        />
      )}
    </div>
  );
}
