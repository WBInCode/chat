import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type DragEvent, type ClipboardEvent } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link, useNavigate } from "react-router-dom";
import type { MessageDto, ModuleKey, ChannelCategoryDto, TaskSearchResult, DocumentSearchResultDto } from "@chatv2/shared";
import { decydujPowiadomienie, WZMIANKA_ZBIOROWA } from "@chatv2/shared";
import { formatTaskRef } from "@chatv2/shared";
import { apiFetch, ApiError } from "../../lib/api.js";
import { uploadFile, uploadEncryptedFile, isAllowedFile, MAX_FILE_SIZE_BYTES } from "../../lib/upload.js";
import { connectSocket, disconnectSocket, getSocket } from "../../lib/socket.js";
import { useAuthStore } from "../../stores/auth.js";
import { useChatStore, type ChannelItem } from "../../stores/chat.js";
import { useModulesStore } from "../../stores/modules.js";
import { useTaskSourcesStore } from "../../stores/taskSources.js";
import { MessageRow } from "./MessageRow.js";
import { ThreadPanel } from "./ThreadPanel.js";
import { ProfileCard } from "./ProfileCard.js";
import { SavedPanel } from "./SavedPanel.js";
import { DocumentsPanel } from "./documents/DocumentsPanel.js";
import { ForwardPicker } from "./ForwardPicker.js";
import { EmojiPicker, type PickerAnchor } from "./EmojiPicker.js";
import { ChannelMembersTab } from "./ChannelMembersTab.js";
import { OrgDocumentsModal } from "./OrgDocumentsModal.js";
import { PromptDialog, ConfirmDialog } from "../../components/Dialog.js";
import { GroupDmPicker } from "./GroupDmPicker.js";
import { QuickSwitcher } from "./QuickSwitcher.js";
import { SchedulePicker } from "./SchedulePicker.js";
import { CreatePollModal, type NewPollInput } from "./CreatePollModal.js";
import { ReminderPicker } from "./ReminderPicker.js";
import { VoiceRoom } from "./VoiceRoom.js";
import { ChannelTree } from "./ChannelTree.js";
import { ChannelSettingsModal } from "./ChannelSettingsModal.js";
import { UserStatusControl } from "../../components/UserStatusControl.js";
import { SidebarSection } from "../../components/SidebarSection.js";
import { ThemeToggle } from "../settings/ThemeToggle.js";
import { Avatar } from "../../components/Avatar.js";
import { useAvatarStore } from "../../stores/avatars.js";
import { useIdlePresence } from "../../lib/idlePresence.js";
import { useVisualViewportHeight } from "../../hooks/useVisualViewportHeight.js";
import { parseSearchFilters } from "../../lib/searchFilters.js";
import { getDraft, setDraft as setDraftPersisted, clearDraft as clearDraftPersisted, hasDraft } from "../../lib/drafts.js";
import {
  ensureKeyPublished,
  checkPeerKey,
  trustPeerKey,
  encryptForPeer,
  encodePayload,
  type PeerKeyStatus,
  type E2eFileRef
} from "../../lib/e2e.js";
import { E2eVerifyModal } from "./E2eVerifyModal.js";
import { playMessageChime, playMentionChime, startRing, stopRing } from "../../lib/sound.js";
import { useNotifyPrefsStore } from "../../stores/notifyPrefs.js";
import { usePresenceModeStore } from "../../stores/presenceMode.js";
import { zsynchronizujPush } from "../../lib/push.js";
import { Icon } from "../../components/Icon.js";
import { glassButtonGhost } from "../../styles/glass.js";
import { Paperclip, BarChart3, Clock, Star, Bell, BellOff, Users, Pin, Bookmark, X, Plus, Sparkles, Mic, Menu, Send, Search, MoreVertical, Bold, Italic, Code, Link2, Strikethrough, Smile, ChevronDown, Check, Eye, Lock, Hash, Settings, Shield, LogOut, MessageSquare, ArrowDown, ShieldCheck, ShieldAlert, Timer, FileText } from "lucide-react";
import { CreateChannelModal } from "./CreateChannelModal.js";
import { CategorySettingsModal } from "./CategorySettingsModal.js";
import { renderMarkdown } from "./markdown.js";
import { BrowseChannelsModal } from "./BrowseChannelsModal.js";

/**
 * Wzmianka o zadaniu: "!" musi zaczynać wyraz, żeby zwykły wykrzyknik na końcu
 * zdania nie otwierał podpowiedzi. Grupa 1 to znak poprzedzający, grupa 2 fraza.
 */
const WYZWALACZ_ZADANIA = /(^|\s)!([\p{L}\d -]{0,40})$/u;

/**
 * Zbiera stan z magazynów i pyta wspólną regułę, czy zagrać. Sama reguła siedzi
 * w `@chatv2/shared`, żeby dało się ją sprawdzić testem i żeby istniała jedna
 * definicja zamiast dwóch rozjeżdżających się.
 */
function zagrajPowiadomienie(m: MessageDto) {
  const me = useAuthStore.getState().user;
  if (!me) return;

  const chan = useChatStore.getState().channels.find((c) => c.id === m.channelId);
  const tresc = m.content ?? "";

  const decyzja = decydujPowiadomienie({
    wlasna: m.authorId === me.id,
    kanalZnany: !!chan,
    wyciszony: !!chan?.muted,
    niePrzeszkadzac: usePresenceModeStore.getState().manual === "dnd",
    tryb: useNotifyPrefsStore.getState().mode,
    wzmianka: tresc.includes(`@${me.displayName}`) || WZMIANKA_ZBIOROWA.test(tresc),
    rozmowaPrywatna: chan?.type === "DM"
  });

  // Wzmianki i rozmowy prywatne mają własny, wyraźniejszy dźwięk. Był
  // zdefiniowany od początku, ale nikt go nigdy nie wywoływał.
  if (decyzja === "wzmianka") playMentionChime();
  else if (decyzja === "wiadomosc") playMessageChime();
}

/** True when two dates fall on the same calendar day (local time). */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Human label for a disappearing-messages TTL (seconds). */
function formatTtl(seconds: number): string {
  if (seconds === 3600) return "godzinie";
  if (seconds === 86400) return "24 godzinach";
  if (seconds === 604800) return "7 dniach";
  if (seconds === 2592000) return "30 dniach";
  const hours = Math.round(seconds / 3600);
  return `${hours} godz.`;
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

/**
 * Opis okna dialogowego do wyświetlenia. Trzymamy go w stanie zamiast wołać
 * blokujące window.prompt/confirm, dzięki czemu okna wyglądają jak reszta
 * aplikacji, a nie jak komunikat przeglądarki.
 */
type DialogRequest =
  | {
      kind: "prompt";
      title: string;
      label: string;
      initialValue?: string;
      placeholder?: string;
      confirmLabel?: string;
      onConfirm: (value: string) => Promise<void>;
    }
  | {
      kind: "confirm";
      title: string;
      message: React.ReactNode;
      confirmLabel?: string;
      danger?: boolean;
      requirePhrase?: string;
      onConfirm: () => Promise<void>;
    };

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
  useVisualViewportHeight();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clear);
  const navigate = useNavigate();
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
    applyReadUpdate,
    applyChannelSettings
  } = useChatStore();

  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false);
  const [members, setMembers] = useState<MemberItem[]>([]);
  // Konta techniczne (System, Asystent AI, Integracje) pisza w kanale, ale nie
  // naleza do organizacji, wiec nie ma ich na liscie czlonkow. Bez tego ich
  // wiadomosci podpisywalyby sie jako „Nieznany”.
  const [channelMembers, setChannelMembers] = useState<MemberItem[]>([]);
  // E2E: peer public keys per DM channel (null = peer has no key yet).
  // E2E: per-DM key verification state. Holds not just the peer key but
  // whether it still matches the one pinned on first contact, so a silent
  // server-side key swap becomes a visible, blocking event.
  const [peerKeys, setPeerKeys] = useState<Record<string, PeerKeyStatus | undefined>>({});
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [showTtlMenu, setShowTtlMenu] = useState(false);
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
  // Last-seen voice participant ids per channel, so a 0 -> 1+ transition
  // (someone just joined) can be told apart from a page-load snapshot.
  const voiceParticipantsRef = useRef<Record<string, string[]>>({});
  // Distance from the current scroll position to the bottom of the content,
  // captured right before prepending older messages so we can re-anchor the
  // viewport (the content below the prepend is unchanged).
  const restoreBottomGapRef = useRef<number | null>(null);
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  const [showDocuments, setShowDocuments] = useState(false);
  const [showOrgDocuments, setShowOrgDocuments] = useState(false);
  const [showGroupDmPicker, setShowGroupDmPicker] = useState(false);
  const [groupDmSelection, setGroupDmSelection] = useState<Set<string>>(new Set());
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [createChannelCategoryId, setCreateChannelCategoryId] = useState<string | null>(null);
  const [showBrowseChannels, setShowBrowseChannels] = useState(false);
  const [categories, setCategories] = useState<ChannelCategoryDto[]>([]);
  const [categoryModal, setCategoryModal] = useState<{
    open: boolean;
    category: ChannelCategoryDto | null;
  }>({ open: false, category: null });
  const [settingsChannelId, setSettingsChannelId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"overview" | "members" | "permissions">(
    "overview"
  );
  // Uchwyty na funkcje wołane z obsługi zdarzeń gniazda. Sam efekt gniazda
  // montuje się raz, więc bez refów trzymałby pierwsze, nieaktualne domknięcia.
  const reloadChannelsRef = useRef<(() => Promise<void>) | null>(null);
  const removeChannelFromViewRef = useRef<((channelId: string) => void) | null>(null);
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
  // Kept in sync below; read imperatively from the socket handler so joining
  // a call doesn't require resubscribing the whole socket effect.
  const inVoiceChannelIdRef = useRef<string | null>(null);
  useEffect(() => {
    inVoiceChannelIdRef.current = inVoiceChannelId;
    // Joining silences any ring for that channel immediately, without
    // waiting for the next voice:participants broadcast.
    if (inVoiceChannelId) stopRing();
  }, [inVoiceChannelId]);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showComposerActions, setShowComposerActions] = useState(false);
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);
  const [composerEmojiAnchor, setComposerEmojiAnchor] = useState<PickerAnchor | null>(null);
  const [showComposerMenu, setShowComposerMenu] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showChannelMenu, setShowChannelMenu] = useState(false);
  const [wsDisconnected, setWsDisconnected] = useState(false);
  useIdlePresence(user ? getSocket() : null);

  const moduleState = useModulesStore((s) => s.modules);
  const loadModules = useModulesStore((s) => s.loadModules);
  const moduleEnabled = (key: ModuleKey) => moduleState[key] !== false;
  const taskSources = useTaskSourcesStore((s) => s.sources);
  const loadTaskSources = useTaskSourcesStore((s) => s.loadSources);

  useEffect(() => {
    void apiFetch<{ enabled: boolean }>("/ai/status")
      .then((r) => setAiEnabled(r.enabled))
      .catch(() => setAiEnabled(false));

    // Tryb powiadomień jest potrzebny do decyzji o dźwięku, więc musi żyć poza
    // ekranem ustawień. Przy błędzie zostaje domyślne "ALL" — lepiej zagrać
    // za dużo niż wyciszyć komuś czat przez nieudane zapytanie.
    void apiFetch<{ mode: "ALL" | "MENTIONS" | "NONE" }>("/me/notification-preferences")
      .then((r) => useNotifyPrefsStore.getState().setMode(r.mode))
      .catch(() => {});

    void zsynchronizujPush();
  }, []);

  // Load per-org module state so the UI hides disabled features (F7-A).
  useEffect(() => {
    if (activeOrgId) void loadModules(activeOrgId);
  }, [activeOrgId, loadModules]);

  // Wzory adresów zadań — potrzebne do zbudowania odnośnika pod plakietką
  // także wtedy, gdy czytający sam niczego nie wyszukiwał.
  useEffect(() => {
    if (activeOrgId) void loadTaskSources(activeOrgId);
  }, [activeOrgId, loadTaskSources]);
  const [draft, setDraft] = useState("");
  const [draftChannels, setDraftChannels] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [documentResults, setDocumentResults] = useState<DocumentSearchResultDto[]>([]);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  // Podpowiadanie zadań z innych aplikacji po wpisaniu "!".
  const [taskQuery, setTaskQuery] = useState<string | null>(null);
  const [taskResults, setTaskResults] = useState<TaskSearchResult[]>([]);
  const [taskLoading, setTaskLoading] = useState(false);
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

  // Układ kanałów jest wspólny dla organizacji, więc przeciąganie, kategorie
  // i usuwanie kanałów są dostępne tylko dla ról, które mogą nim zarządzać.
  const canManageChannels = (() => {
    const role = orgs.find((o) => o.id === activeOrgId)?.role;
    return role === "OWNER" || role === "ADMIN";
  })();

  /**
   * Prawo do zarządzania konkretnym kanałem. Rola administratora kanału trafia
   * wyłącznie do twórcy, więc bez uwzględnienia uprawnień organizacji nikt inny
   * nie mógłby ruszyć cudzego kanału. Odpowiada regule z assertChannelAdmin.
   */
  function mozeZarzadzac(channel: { myRole?: "ADMIN" | "MEMBER" } | null | undefined) {
    return channel?.myRole === "ADMIN" || canManageChannels;
  }

  useEffect(() => {
    void apiFetch<OrgItem[]>("/orgs").then((data) => {
      setOrgs(data);
      // Restore the last-used org (multi-org users), else the first one.
      const saved = localStorage.getItem("chatv2-active-org");
      const pick = data.find((o) => o.id === saved) ?? data[0];
      if (pick) setActiveOrg(pick.id);
    });
  }, [setActiveOrg]);

  // ── unread digest toast: shown once right after the app loads ──────────
  useEffect(() => {
    void apiFetch<{ totalUnread: number; mentionCount: number; channelCount: number }>(
      "/me/unread-summary"
    ).then((summary) => {
      if (summary.mentionCount > 0) {
        setDigestToast(
          `${summary.mentionCount} ${summary.mentionCount === 1 ? "nowa wzmianka" : "nowe wzmianki"} w ${summary.channelCount} ${summary.channelCount === 1 ? "kanale" : "kanałach"}`
        );
        setTimeout(() => setDigestToast(null), 6000);
      }
    });
  }, []);

  // ── document title badge: total unread across non-muted channels ──────
  useEffect(() => {
    const total = channels.reduce((sum, c) => (c.muted ? sum : sum + (c.unreadCount ?? 0)), 0);
    document.title = total > 0 ? `(${total}) Chat WB-Platform` : "Chat WB-Platform";
  }, [channels]);

  useEffect(() => {
    if (!activeOrgId) return;
    void apiFetch<ChannelItem[]>(`/orgs/${activeOrgId}/channels`).then((data) => {
      setChannels(data);
      if (data[0]) setActiveChannel(data[0].id);
      setDraftChannels(new Set(data.filter((c) => hasDraft(c.id)).map((c) => c.id)));
    });
    void apiFetch<ChannelCategoryDto[]>(`/orgs/${activeOrgId}/categories`).then(setCategories);
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

      zagrajPowiadomienie(m);
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
    socket.on("channel:settings-updated", ({ channelId, e2ee, messageTtlSeconds }) =>
      applyChannelSettings(channelId, { e2ee, messageTtlSeconds })
    );

    // Układ kanałów jest wspólny, więc zmiana u administratora musi od razu
    // pojawić się u wszystkich. Przeładowujemy listę zamiast łatać stan
    // lokalnie — zmiana mogła dotknąć wielu kanałów i kategorii naraz.
    socket.on("channels:layout-updated", () => {
      void reloadChannelsRef.current?.();
    });
    socket.on("channel:deleted", ({ channelId }) => {
      removeChannelFromViewRef.current?.(channelId);
    });

    // Incoming call "ring": a channel I belong to (but am not currently
    // joined into) just went from 0 participants to 1+ — someone started
    // a voice call. Rings until they hang up, I join, or I dismiss it.
    socket.on("voice:participants", ({ channelId, participants }) => {
      const prev = voiceParticipantsRef.current[channelId] ?? [];
      voiceParticipantsRef.current[channelId] = participants.map((p) => p.userId);
      const me = useAuthStore.getState().user;
      const others = participants.filter((p) => p.userId !== me?.id);
      const wasEmpty = prev.filter((id) => id !== me?.id).length === 0;
      const amInThisCall = inVoiceChannelIdRef.current === channelId;
      if (wasEmpty && others.length > 0 && !amInThisCall) {
        const chan = useChatStore.getState().channels.find((c) => c.id === channelId);
        startRing();
        showToast(`Połączenie głosowe: ${chan?.name ?? "kanał"}`, 6000);
      }
      if (others.length === 0 || amInThisCall) {
        stopRing();
      }
    });

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
      socket.off("channel:settings-updated");
      socket.off("voice:participants");
      socket.off("disconnect", onDisconnect);
      socket.off("connect", onConnect);
      disconnectSocket();
      stopRing();
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
    applyReadUpdate,
    applyChannelSettings
  ]);

  // ── E2E bootstrap: publish this device's public key once after login ────
  useEffect(() => {
    void ensureKeyPublished();
  }, []);

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

    // Uczestnicy kanalu obejmuja konta techniczne, ktorych nie ma w organizacji.
    void apiFetch<MemberItem[]>(`/channels/${activeChannelId}/members`)
      .then((data) => {
        setChannelMembers(data);
        useAvatarStore.getState().ensure(data.map((m) => m.userId));
      })
      .catch(() => setChannelMembers([]));
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

  // Układ listy kanałów jest wspólny dla całej organizacji, więc zapis idzie
  // jednym żądaniem i dotyczy wszystkich. Najpierw zmieniamy stan lokalny, żeby
  // przeciąganie było płynne, a gdy serwer odmówi — przywracamy poprzedni układ
  // i mówimy o tym wprost, zamiast zostawiać widok rozjechany z bazą.
  function applyLayout(
    nextCategories: Array<{ id: string; position: number }>,
    nextChannels: Array<{ id: string; categoryId: string | null; position: number }>
  ) {
    if (!activeOrgId) return;
    const previousChannels = channels;
    const previousCategories = categories;

    const channelPatch = new Map(nextChannels.map((c) => [c.id, c]));
    setChannels(
      channels.map((c) => {
        const patch = channelPatch.get(c.id);
        return patch ? { ...c, categoryId: patch.categoryId, position: patch.position } : c;
      })
    );
    const categoryPatch = new Map(nextCategories.map((c) => [c.id, c.position]));
    setCategories(
      [...categories]
        .map((c) => ({ ...c, position: categoryPatch.get(c.id) ?? c.position }))
        .sort((a, b) => a.position - b.position)
    );

    void apiFetch(`/orgs/${activeOrgId}/channel-layout`, {
      method: "PATCH",
      body: JSON.stringify({ categories: nextCategories, channels: nextChannels })
    }).catch((e) => {
      setChannels(previousChannels);
      setCategories(previousCategories);
      showToast(e instanceof ApiError ? e.message : "Nie udało się zapisać układu kanałów.");
    });
  }

  function openChannelSettings(channelId: string, tab: "overview" | "members" | "permissions" = "overview") {
    setSettingsInitialTab(tab);
    setSettingsChannelId(channelId);
  }

  async function reloadChannels() {
    if (!activeOrgId) return;
    const [freshChannels, freshCategories] = await Promise.all([
      apiFetch<ChannelItem[]>(`/orgs/${activeOrgId}/channels`),
      apiFetch<ChannelCategoryDto[]>(`/orgs/${activeOrgId}/categories`)
    ]);
    setChannels(freshChannels);
    setCategories(freshCategories);
  }

  function createCategory() {
    if (!activeOrgId) return;
    setCategoryModal({ open: true, category: null });
  }

  function renameCategory(category: ChannelCategoryDto) {
    setCategoryModal({ open: true, category });
  }

  function deleteCategory(category: ChannelCategoryDto) {
    const inside = channels.filter((c) => c.categoryId === category.id).length;
    setDialog({
      kind: "confirm",
      title: `Usunąć kategorię „${category.name}"?`,
      danger: true,
      confirmLabel: "Usuń kategorię",
      message:
        inside > 0
          ? `${inside} ${inside === 1 ? "kanał trafi" : "kanały trafią"} poza kategorie. Same kanały i ich historia zostają nietknięte.`
          : "Kategoria jest pusta, więc nic poza nią nie zniknie.",
      onConfirm: async () => {
        await apiFetch(`/categories/${category.id}`, { method: "DELETE" });
        setCategories((prev) => prev.filter((c) => c.id !== category.id));
        setChannels(channels.map((c) => (c.categoryId === category.id ? { ...c, categoryId: null } : c)));
        setDialog(null);
      }
    });
  }

  function archiveChannel(channel: ChannelItem) {
    setDialog({
      kind: "confirm",
      title: `Zarchiwizować kanał #${channel.name}?`,
      confirmLabel: "Archiwizuj",
      message: "Kanał zniknie z listy i stanie się tylko do odczytu. Historia zostaje i da się go przywrócić.",
      onConfirm: async () => {
        await apiFetch(`/channels/${channel.id}/archive`, { method: "POST" });
        setChannels(
          channels.map((c) => (c.id === channel.id ? { ...c, archivedAt: new Date().toISOString() } : c))
        );
        setDialog(null);
        showToast("Kanał zarchiwizowany.");
      }
    });
  }

  function removeChannelFromView(channelId: string) {
    const remaining = channels.filter((c) => c.id !== channelId);
    setChannels(remaining);
    if (activeChannelId === channelId) setActiveChannel(remaining[0]?.id ?? null);
  }

  function deleteChannel(channel: ChannelItem) {
    setDialog({
      kind: "confirm",
      title: `Usunąć kanał #${channel.name}?`,
      danger: true,
      confirmLabel: "Usuń kanał",
      // Nazwa do przepisania, bo kasujemy razem z historią i załącznikami,
      // a tego nie da się cofnąć.
      requirePhrase: channel.name ?? "",
      message:
        "Kanał zniknie razem z całą historią wiadomości i załącznikami. Tej operacji nie da się cofnąć.",
      onConfirm: async () => {
        await apiFetch(`/channels/${channel.id}`, { method: "DELETE" });
        removeChannelFromView(channel.id);
        setDialog(null);
        showToast("Kanał usunięty.");
      }
    });
  }

  reloadChannelsRef.current = reloadChannels;
  removeChannelFromViewRef.current = removeChannelFromView;

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
      setAiSummary(e instanceof ApiError ? e.message : "AI nie odpowiedziało. Spróbuj ponownie.");
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
    overscan: 10,
    // Key measured heights by stable message id, not array index: messages
    // get prepended (older history), spliced (optimistic tempId -> real id
    // reconciliation) and edited/deleted via WebSocket, all of which shift
    // what's at a given index. Index-keyed measurement cache then reuses a
    // stale height for the wrong message, producing wrong translateY offsets
    // (rows overlapping / stacking) until a full remount clears the cache.
    getItemKey: (index) => channelMessages[index]!.id
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
    // Uzupelniamy o uczestnikow samego kanalu — tylko do podpisywania wiadomosci.
    // Do listy `members` ich nie dokladamy, bo ta zasila podpowiedzi wzmianek.
    for (const m of channelMembers) if (!map.has(m.userId)) map.set(m.userId, m);
    return map;
  }, [members, channelMembers]);

  const activeChannel = channels.find((c) => c.id === activeChannelId);

  // W kanale ogłoszeniowym pisać mogą administratorzy kanału oraz osoby
  // zarządzające kanałami w organizacji. Blokujemy pole od razu, zamiast
  // pozwolić napisać wiadomość i odrzucić ją przy wysyłce.
  const readOnlyAnnouncement =
    activeChannel?.kind === "ANNOUNCEMENT" && !mozeZarzadzac(activeChannel);

  // Rozmowa z nadawcą System jest jednostronna: nie ma komu odpowiedzieć.
  const tylkoDoOdczytu = activeChannel?.readOnly === true;
  const bezPisania = readOnlyAnnouncement || tylkoDoOdczytu;

  // Tryb wolny obowiązuje wszystkich poza administratorami kanału. Sam limit
  // egzekwuje serwer; tutaj tylko uprzedzamy, żeby odmowa nie była zaskoczeniem.
  const slowmodeNotice = (() => {
    const seconds = activeChannel?.slowmodeSeconds ?? 0;
    if (seconds <= 0 || activeChannel?.myRole === "ADMIN") return null;
    if (seconds < 60) return `tryb wolny: ${seconds} s`;
    if (seconds < 3600) return `tryb wolny: ${Math.round(seconds / 60)} min`;
    return `tryb wolny: ${Math.round(seconds / 3600)} godz.`;
  })();

  // ── E2E: verify the DM peer's key against the local pin on open ───────
  useEffect(() => {
    if (!activeChannel?.e2ee || activeChannel.type !== "DM" || !user) return;
    if (peerKeys[activeChannel.id] !== undefined) return;
    void checkPeerKey(activeChannel.id, user.id)
      .then((status) => setPeerKeys((prev) => ({ ...prev, [activeChannel.id]: status })))
      .catch(() => setPeerKeys((prev) => ({ ...prev, [activeChannel.id]: { state: "missing" } })));
  }, [activeChannel, user, peerKeys]);

  const peerKeyStatus = activeChannel?.e2ee ? peerKeys[activeChannel.id] : undefined;
  const peerKeyChanged = peerKeyStatus?.state === "changed";
  const activePeerKey = peerKeyStatus?.state === "ok" ? peerKeyStatus.publicKey : null;

  /** Accepts a changed peer key after the user verified the safety number. */
  function trustChangedPeerKey() {
    if (!activeChannel || peerKeyStatus?.state !== "changed") return;
    trustPeerKey(peerKeyStatus.peerUserId, peerKeyStatus.publicKey);
    setPeerKeys((prev) => ({
      ...prev,
      [activeChannel.id]: {
        state: "ok",
        peerUserId: peerKeyStatus.peerUserId,
        publicKey: peerKeyStatus.publicKey,
        safetyNumber: peerKeyStatus.safetyNumber,
        firstUse: false
      }
    }));
    setShowVerifyModal(false);
    showToast("Nowy klucz zaufany");
  }

  /** E2E toggle for 1:1 DMs. Enabling requires both published keys. */
  async function toggleE2e(enabled: boolean) {
    if (!activeChannel) return;
    try {
      await ensureKeyPublished();
      const res = await apiFetch<{ channelId: string; e2ee: boolean }>(
        `/channels/${activeChannel.id}/e2e`,
        { method: "PATCH", body: JSON.stringify({ enabled }) }
      );
      applyChannelSettings(activeChannel.id, { e2ee: res.e2ee });
      if (res.e2ee) {
        // Refresh the peer key so the composer can encrypt right away.
        setPeerKeys((prev) => {
          const next = { ...prev };
          delete next[activeChannel.id];
          return next;
        });
        showToast("Szyfrowanie end-to-end włączone");
      } else {
        showToast("Szyfrowanie end-to-end wyłączone");
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Nie udało się zmienić szyfrowania");
    }
  }

  /** Disappearing messages TTL (null = off). */
  async function setChannelTtl(ttlSeconds: number | null) {
    if (!activeChannel) return;
    setShowTtlMenu(false);
    try {
      const res = await apiFetch<{ channelId: string; messageTtlSeconds: number | null }>(
        `/channels/${activeChannel.id}/ttl`,
        { method: "PATCH", body: JSON.stringify({ messageTtlSeconds: ttlSeconds }) }
      );
      applyChannelSettings(activeChannel.id, { messageTtlSeconds: res.messageTtlSeconds });
      showToast(
        res.messageTtlSeconds
          ? `Wiadomości znikają po ${formatTtl(res.messageTtlSeconds)}`
          : "Znikanie wiadomości wyłączone"
      );
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Nie udało się zmienić ustawienia");
    }
  }

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
          : !isAllowedFile(file)
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

    // E2E: encrypt before anything touches the wire. Attachments are
    // encrypted in the browser too, and their keys ride inside the encrypted
    // message body, so the server only ever stores opaque blobs.
    const isE2e = !!activeChannel?.e2ee;
    let wireContent = content;
    if (isE2e) {
      // Hard stop on an unverified key change: sending here could mean
      // encrypting to whoever supplied the substituted key.
      if (peerKeyChanged) {
        setShowVerifyModal(true);
        return;
      }
      if (!activePeerKey) {
        showToast("Brak klucza rozmówcy. Poproś go o otwarcie aplikacji i spróbuj ponownie.");
        return;
      }

      let encryptedFiles: E2eFileRef[] = [];
      if (hasFiles) {
        const valid = pending.filter((p) => !p.error);
        try {
          encryptedFiles = await Promise.all(
            valid.map((p) =>
              uploadEncryptedFile(p.file, activeChannelId, (pct) =>
                setPending((prev) =>
                  prev.map((c) => (c.localId === p.localId ? { ...c, progress: pct } : c))
                )
              )
            )
          );
        } catch (err) {
          showToast(err instanceof Error ? err.message : "Nie udało się wysłać załącznika");
          return;
        }
      }
      if (!content && encryptedFiles.length === 0) return;

      wireContent = encryptForPeer(
        encodePayload({ text: content, ...(encryptedFiles.length > 0 ? { files: encryptedFiles } : {}) }),
        activePeerKey
      );
    }

    let fileIds: string[] = [];
    if (hasFiles && !isE2e) {
      fileIds = await uploadPending(activeChannelId);
      if (fileIds.length === 0 && !content) return; // all uploads failed, nothing to send
    }

    const tempId = `temp-${crypto.randomUUID()}`;
    // Optimistic UI: render immediately, reconciled by tempId on message:new.
    // For E2E the optimistic row carries the CIPHERTEXT (same as the echo
    // from the server) — MessageRow decrypts at render time.
    addMessage({
      id: tempId,
      channelId: activeChannelId,
      authorId: user.id,
      content: wireContent,
      contentType: isE2e ? "e2e" : fileIds.length > 0 ? "file" : "text",
      parentId: null,
      editedAt: null,
      createdAt: new Date().toISOString()
    });

    getSocket().emit("message:send", {
      channelId: activeChannelId,
      tempId,
      content: wireContent,
      ...(isE2e ? { contentType: "e2e" as const } : {}),
      fileIds
    });
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
    const content = `Przekazane od **${authorName}**:\n${quoted}${comment.trim() ? `\n\n${comment.trim()}` : ""}`;
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
    showToast("Wiadomość zaplanowana");
  }

  async function submitPoll(input: NewPollInput) {
    if (!activeChannelId) return;
    await apiFetch(`/channels/${activeChannelId}/polls`, {
      method: "POST",
      body: JSON.stringify(input)
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
    showToast("Przypomnienie ustawione");
  }

  // ── permalink navigation: ?channel=X&msg=Y jumps straight to a message ──
  useEffect(() => {
    if (permalinkHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const targetChannel = params.get("channel");
    const targetMsg = params.get("msg");
    if (!targetChannel || channels.length === 0) return;

    // Powiadomienie bez wskazanej wiadomości (np. o komentarzu w dokumencie)
    // ma otworzyć sam kanał — wcześniej lądowało się na stronie głównej.
    if (!targetMsg) {
      permalinkHandled.current = true;
      setActiveChannel(targetChannel);
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
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
    // Wzmianka o zadaniu. "!" musi zaczynać wyraz, żeby zwykły wykrzyknik
    // na końcu zdania ("super!") nie otwierał podpowiedzi.
    const zadanie = value.match(WYZWALACZ_ZADANIA);
    setTaskQuery(zadanie ? (zadanie[2] ?? "") : null);
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

  function insertBroadcastMention(token: string) {
    setDraft((d) => d.replace(/@([\p{L}\d ]{0,30})$/u, `@${token} `));
    setMentionQuery(null);
  }

  function insertTaskRef(wynik: TaskSearchResult) {
    setDraft((d) =>
      d.replace(WYZWALACZ_ZADANIA, (_calosc, przed: string) =>
        `${przed}${formatTaskRef(wynik.sourceKey, wynik.id, wynik.title)} `
      )
    );
    setTaskQuery(null);
    setTaskResults([]);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  // Zapytanie idzie do aplikacji źródłowych, więc czekamy na przerwę w pisaniu.
  useEffect(() => {
    if (taskQuery === null || !activeOrgId || !moduleEnabled("task-refs")) {
      setTaskResults([]);
      setTaskLoading(false);
      return;
    }
    let porzucone = false;
    setTaskLoading(true);
    const timer = setTimeout(() => {
      void apiFetch<TaskSearchResult[]>(
        `/orgs/${activeOrgId}/task-search?q=${encodeURIComponent(taskQuery)}`
      )
        .then((r) => { if (!porzucone) setTaskResults(r); })
        .catch(() => { if (!porzucone) setTaskResults([]); })
        .finally(() => { if (!porzucone) setTaskLoading(false); });
    }, 250);
    return () => { porzucone = true; clearTimeout(timer); };
  }, [taskQuery, activeOrgId, moduleState]);

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

  // Broadcast mentions offered in the @-autocomplete (channels only, not DMs).
  const mentionBroadcasts =
    mentionQuery !== null && activeChannel && activeChannel.type !== "DM"
      ? (
          [
            { token: "channel", label: "@channel", desc: "Powiadom wszystkich w kanale" },
            { token: "here", label: "@here", desc: "Powiadom obecnych online" }
          ] as const
        ).filter(
          (b) =>
            mentionQuery === "" ||
            b.token.startsWith(mentionQuery.toLowerCase()) ||
            (b.token === "channel" && "wszyscy".startsWith(mentionQuery.toLowerCase()))
        )
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

    // Dokumenty mają osobną trasę, bo wynik wskazuje dokument, nie wiadomość.
    // Szukamy ich tylko po tekście — filtry typu `from:` czy `has:file` dotyczą
    // wiadomości i dla dokumentów nic nie znaczą.
    if (parsed.text.length < 2 || !moduleEnabled("documents")) {
      setDocumentResults([]);
      return;
    }
    const paramsDok = new URLSearchParams({ orgId: activeOrgId, q: parsed.text });
    if (params.get("channelId")) paramsDok.set("channelId", params.get("channelId")!);
    await apiFetch<{ results: DocumentSearchResultDto[] }>(`/search/documents?${paramsDok}`)
      .then((r) => setDocumentResults(r.results))
      .catch(() => setDocumentResults([]));
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

  // Switch the active organization (multi-org users). Re-scopes channels,
  // members and modules via the activeOrgId effects; persisted for reloads.
  function switchOrg(orgId: string) {
    setShowOrgSwitcher(false);
    if (orgId === activeOrgId) return;
    localStorage.setItem("chatv2-active-org", orgId);
    setActiveChannel(null);
    setActiveOrg(orgId);
  }

  // ── render ─────────────────────────────────────────────────────────────
  return (
    <div className="chat-shell flex h-full gap-0 p-0 md:gap-3 md:p-3" style={{ height: "var(--vvh, 100%)" }}>
      {wsDisconnected && (
        <div className="fixed left-1/2 top-2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--warning)]/90 px-4 py-1.5 text-xs font-medium text-black shadow-lg">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-black/60" />
          Utracono połączenie. Łączenie ponownie…
        </div>
      )}
      {showMobileSidebar && (
        <div
          className="animate-overlay-in fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setShowMobileSidebar(false)}
        />
      )}
      <aside
        onClickCapture={() => {
          if (window.innerWidth < 768) setShowMobileSidebar(false);
        }}
        className={`mobile-drawer glass flex w-[82%] max-w-xs shrink-0 flex-col overflow-hidden max-md:!rounded-none max-md:!border-y-0 max-md:!border-l-0 pl-[env(safe-area-inset-left)] md:static md:z-auto md:w-64 md:pl-0 ${
          showMobileSidebar ? "mobile-drawer--open" : ""
        }`}
      >
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] p-4">
          <div className="relative min-w-0">
            <button
              type="button"
              onClick={() => orgs.length > 1 && setShowOrgSwitcher((v) => !v)}
              className={`flex min-w-0 items-center gap-1.5 font-semibold ${
                orgs.length > 1 ? "hover:text-[var(--accent)]" : "cursor-default"
              }`}
              title={orgs.length > 1 ? "Przełącz organizację" : undefined}
            >
              <span className="truncate font-[family-name:var(--font-display)] tracking-tight">
                {orgs.find((o) => o.id === activeOrgId)?.name ?? "Chat WB-Platform"}
              </span>
              {orgs.length > 1 && <Icon icon={ChevronDown} size={14} className="shrink-0 text-[var(--text-dim)]" />}
            </button>
            {showOrgSwitcher && orgs.length > 1 && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowOrgSwitcher(false)} />
                <div className="animate-slide-up absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-strong)] py-1 shadow-2xl backdrop-blur-lg">
                  <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">
                    Organizacje
                  </p>
                  {orgs.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => switchOrg(o.id)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent)]/15 ${
                        o.id === activeOrgId ? "text-[var(--accent)]" : ""
                      }`}
                    >
                      <span className="min-w-0 truncate">{o.name}</span>
                      {o.id === activeOrgId && <Icon icon={Check} size={14} className="shrink-0" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="rounded text-xs text-[var(--text-dim)] transition-colors hover:text-[var(--danger)] touch:px-2 touch:py-3"
            >
              Wyloguj
            </button>
          </div>
        </div>

        <div className="cascade flex-1 overflow-y-auto p-2 [overscroll-behavior:contain]">
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

          {moduleEnabled("documents") && (
            <button
              onClick={() => setShowOrgDocuments(true)}
              className="mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-[var(--text)] transition-colors duration-150 hover:bg-[var(--border)]/50"
            >
              <Icon icon={FileText} size={15} /> Dokumenty
            </button>
          )}

          {channels.some((c) => c.favorite) && (
            <SidebarSection id="favorites" title="Ulubione">
              {channels
                .filter((c) => c.favorite)
                .map((c) => (
                  <button
                    key={`fav-${c.id}`}
                    onClick={() => setActiveChannel(c.id)}
                    data-aktywny={c.id === activeChannelId ? "tak" : undefined}
                    className={`nav-item flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-all duration-150 ${
                      c.id === activeChannelId
                        ? "bg-[var(--accent)]/15 text-[var(--accent)] shadow-[inset_0_0_0_1px_var(--accent-ring)]"
                        : "text-[var(--text)] hover:bg-[var(--border)]/50"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {c.type === "DM" ? (
                        <span className="w-3.5 shrink-0 text-center text-[var(--text-dim)]">@</span>
                      ) : (
                        <Icon icon={c.type === "PRIVATE" ? Lock : Hash} size={13} className="shrink-0 text-[var(--text-dim)]" />
                      )}
                      <span className="truncate">{c.name}</span>
                    </span>
                    {(c.unreadCount ?? 0) > 0 && !c.muted && (
                      <span className="animate-spring-in btn-gradient ml-2 min-w-5 rounded-full px-1.5 text-center text-xs font-semibold text-white shadow-[0_2px_8px_var(--accent-glow)]">
                        {c.unreadCount}
                      </span>
                    )}
                  </button>
                ))}
            </SidebarSection>
          )}

          <div className="mt-3">
            <div className="flex justify-end px-2">
              <button
                onClick={() => setShowBrowseChannels(true)}
                title="Przeglądaj kanały publiczne"
                className="rounded px-1.5 py-0.5 text-xs text-[var(--text-dim)] transition-colors hover:bg-[var(--border)]/40 hover:text-[var(--accent)] touch:px-3 touch:py-2.5"
              >
                Przeglądaj
              </button>
            </div>
            <ChannelTree
              channels={channels}
              categories={categories}
              activeChannelId={activeChannelId}
              draftChannels={draftChannels}
              canManage={canManageChannels}
              onSelect={setActiveChannel}
              onToggleMute={(channelId, muted) => void toggleMute(channelId, muted)}
              onToggleFavorite={(channelId, favorite) => void toggleFavorite(channelId, favorite)}
              onOpenSettings={(channelId) => openChannelSettings(channelId, "overview")}
              onDelete={deleteChannel}
              onArchive={archiveChannel}
              onCreateChannel={(categoryId) => {
                setCreateChannelCategoryId(categoryId);
                setShowCreateChannel(true);
              }}
              onCreateCategory={createCategory}
              onRenameCategory={renameCategory}
              onDeleteCategory={deleteCategory}
              onLayoutChange={applyLayout}
            />
          </div>

          <SidebarSection
            id="dms"
            title="Wiadomości bezpośrednie"
            action={
              <button
                onClick={() => setShowGroupDmPicker(true)}
                title="Nowa grupa"
                className="flex h-8 items-center rounded px-1.5 text-xs text-[var(--text-dim)] hover:bg-[var(--border)]/40 hover:text-[var(--accent)]"
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
                  data-aktywny={c.id === activeChannelId ? "tak" : undefined}
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
                    <span className="animate-spring-in btn-gradient ml-2 min-w-5 rounded-full px-1.5 text-center text-xs font-semibold text-white shadow-[0_2px_8px_var(--accent-glow)]">
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
                    <Avatar userId={m.userId} displayName={m.displayName} url={avatarUrls[m.userId]} size={26} />
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
            displayName={user?.displayName ?? "Użytkownik"}
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
            <header
              className="flex items-center justify-between gap-4 border-b border-[var(--glass-border)] px-4 py-3"
              style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setShowMobileSidebar(true)}
                    title="Menu"
                    className="-ml-1 p-1 text-[var(--text-dim)] hover:text-[var(--text)] touch:-m-2 touch:-ml-3 touch:p-3 md:hidden"
                  >
                    <Icon icon={Menu} size={22} />
                  </button>
                  <h1 className="flex min-w-0 items-center gap-1.5 truncate text-base font-semibold md:text-sm">
                    {activeChannel.type === "DM" ? (
                      <span className="text-[var(--text-dim)]">@</span>
                    ) : (
                      <Icon icon={activeChannel.type === "PRIVATE" ? Lock : Hash} size={15} className="shrink-0 text-[var(--text-dim)]" />
                    )}
                    <span className="truncate">{activeChannel.name}</span>
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
                        onClick={() => openChannelSettings(activeChannel.id, "members")}
                        title="Członkowie kanału"
                        className="text-[var(--text-dim)] hover:text-[var(--text)]"
                      >
                        <Icon icon={Users} size={15} />
                      </button>
                    )}
                    {moduleEnabled("documents") && !activeChannel.e2ee && (
                      <button
                        onClick={() => setShowDocuments((v) => !v)}
                        title="Dokumenty kanału"
                        aria-label="Dokumenty kanału"
                        className={`flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-medium transition-colors ${
                          showDocuments
                            ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                            : "text-[var(--text-dim)] hover:bg-[var(--border)]/40 hover:text-[var(--text)]"
                        }`}
                      >
                        <Icon icon={FileText} size={15} />
                        <span className="hidden lg:inline">Dokumenty</span>
                      </button>
                    )}
                    {/* E2E toggle: 1:1 DMs only, gated by the hub-synced e2ee module */}
                    {activeChannel.type === "DM" && moduleEnabled("e2ee") && (
                      <button
                        onClick={() => void toggleE2e(!activeChannel.e2ee)}
                        title={
                          activeChannel.e2ee
                            ? "Szyfrowanie end-to-end włączone. Kliknij, aby wyłączyć dla nowych wiadomości"
                            : "Włącz szyfrowanie end-to-end (tylko Ty i rozmówca przeczytacie wiadomości)"
                        }
                        className={activeChannel.e2ee ? "text-[var(--accent-2)]" : "text-[var(--text-dim)] hover:text-[var(--accent-2)]"}
                      >
                        <Icon icon={ShieldCheck} size={15} />
                      </button>
                    )}
                    {/* Disappearing messages (channel admin; any member in DMs) */}
                    {(activeChannel.type === "DM" || mozeZarzadzac(activeChannel)) && (
                      <div className="relative flex items-center">
                        <button
                          onClick={() => setShowTtlMenu((v) => !v)}
                          title={
                            activeChannel.messageTtlSeconds
                              ? `Wiadomości znikają po ${formatTtl(activeChannel.messageTtlSeconds)}`
                              : "Znikające wiadomości"
                          }
                          className={`flex items-center ${activeChannel.messageTtlSeconds ? "text-[var(--accent)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"}`}
                        >
                          <Icon icon={Timer} size={15} />
                        </button>
                        {showTtlMenu && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowTtlMenu(false)} />
                            <div className="animate-menu-pop absolute left-0 top-full z-20 mt-1 w-60 overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-strong)] py-1 shadow-xl">
                              <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">
                                Znikające wiadomości
                              </p>
                              {[
                                { value: null, label: "Wyłączone" },
                                { value: 3600, label: "Po godzinie" },
                                { value: 86400, label: "Po 24 godzinach" },
                                { value: 604800, label: "Po 7 dniach" },
                                { value: 2592000, label: "Po 30 dniach" }
                              ].map((opt) => (
                                <button
                                  key={String(opt.value)}
                                  onClick={() => void setChannelTtl(opt.value)}
                                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent)]/10 ${
                                    (activeChannel.messageTtlSeconds ?? null) === opt.value ? "text-[var(--accent)]" : ""
                                  }`}
                                >
                                  {opt.label}
                                  {(activeChannel.messageTtlSeconds ?? null) === opt.value && <Icon icon={Check} size={14} />}
                                </button>
                              ))}
                              <p className="border-t border-[var(--glass-border)] px-3 py-2 text-[11px] leading-snug text-[var(--text-dim)]">
                                Starsze wiadomości i ich pliki są trwale usuwane dla wszystkich uczestników.
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {aiEnabled && moduleEnabled("ai") && !activeChannel.e2ee && (
                      <button
                        onClick={() => void runAiSummary()}
                        disabled={aiSummaryLoading}
                        title="Podsumuj czego nie przeczytałeś (AI)"
                        className="text-[var(--text-dim)] hover:text-[var(--accent)] disabled:opacity-40"
                      >
                        <Icon icon={Sparkles} size={15} />
                      </button>
                    )}
                    {activeChannel.type !== "DM" && moduleEnabled("voice") && (
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
                      className="p-1 text-[var(--text-dim)] hover:text-[var(--text)] touch:-m-2 touch:p-3"
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
                              openChannelSettings(activeChannel.id, "members");
                            }}
                            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                          >
                            <Icon icon={Users} size={16} /> Członkowie kanału
                          </button>
                        )}
                        {activeChannel.type !== "DM" && mozeZarzadzac(activeChannel) && (
                          <button
                            onClick={() => {
                              setShowChannelMenu(false);
                              openChannelSettings(activeChannel.id, "overview");
                            }}
                            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                          >
                            <Icon icon={Settings} size={16} /> Ustawienia kanału
                          </button>
                        )}
                        {moduleEnabled("documents") && !activeChannel.e2ee && (
                          <button
                            onClick={() => {
                              setShowChannelMenu(false);
                              setShowDocuments(true);
                            }}
                            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                          >
                            <Icon icon={FileText} size={16} /> Dokumenty kanału
                          </button>
                        )}
                        {aiEnabled && moduleEnabled("ai") && !activeChannel.e2ee && (
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
                        {activeChannel.type !== "DM" && moduleEnabled("voice") && (
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
                      if (!mozeZarzadzac(activeChannel)) return;
                      setTopicDraft(activeChannel.topic ?? "");
                      setEditingTopic(true);
                    }}
                    className={`min-h-6 truncate py-1 text-left text-xs text-[var(--text-dim)] ${mozeZarzadzac(activeChannel) ? "hover:text-[var(--text)]" : ""}`}
                  >
                    {activeChannel.topic || (mozeZarzadzac(activeChannel) ? "+ Dodaj temat kanału" : "")}
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
                  className={`-m-1.5 flex h-11 w-11 items-center justify-center text-[var(--text-dim)] hover:text-[var(--text)] md:hidden ${moduleEnabled("search") ? "" : "hidden"}`}
                >
                  <Icon icon={Search} size={18} />
                </button>
                {moduleEnabled("search") && (
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
                )}
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
                  <ul className="max-h-48 space-y-1 overflow-y-auto [overscroll-behavior:contain]">
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

                {documentResults.length > 0 && (
                  <>
                    <div className="mb-1 mt-2 border-t border-[var(--glass-border)] pt-2 text-xs font-medium text-[var(--text-dim)]">
                      Dokumenty ({documentResults.length})
                    </div>
                    <ul className="max-h-48 space-y-1 overflow-y-auto [overscroll-behavior:contain]">
                      {documentResults.map((d) => (
                        <li key={d.documentId}>
                          <button
                            onClick={() => {
                              openSearchResult(d.channelId);
                              setShowDocuments(true);
                            }}
                            className="w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--border)]/40"
                          >
                            <span className="text-[var(--text-dim)]">
                              {d.channelName ? `#${d.channelName}` : "@ DM"}
                            </span>
                            <span className="block font-medium text-[var(--text)]">
                              {d.icon ? `${d.icon} ` : ""}
                              {d.title}
                            </span>
                            <span className="block truncate text-[var(--text-dim)]">{d.snippet}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            <div
              ref={scrollRef}
              className="relative flex-1 overflow-y-auto px-4 py-3 [overscroll-behavior:contain]"
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
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]">
                    <Icon icon={activeChannel.type === "DM" ? MessageSquare : Hash} size={22} />
                  </span>
                  <p className="text-sm font-medium">
                    {activeChannel.type === "DM"
                      ? `To początek rozmowy z ${activeChannel.name}`
                      : `To początek kanału #${activeChannel.name}`}
                  </p>
                  <p className="max-w-xs text-xs text-[var(--text-dim)]">
                    {tylkoDoOdczytu
                      ? "Tu trafiają powiadomienia z pozostałych aplikacji. Odpowiadać się nie da."
                      : readOnlyAnnouncement
                        ? "To kanał ogłoszeniowy. Pojawią się tu wpisy administratorów kanału."
                        : "Napisz pierwszą wiadomość poniżej. Możesz też przeciągnąć plik, wkleić obrazek, utworzyć ankietę (+) albo wspomnieć kogoś przez @."}
                  </p>
                  {moduleEnabled("documents") && !activeChannel.e2ee && !bezPisania && (
                    <button
                      onClick={() => setShowDocuments(true)}
                      className="mt-1 flex items-center gap-1.5 rounded-lg border border-[var(--glass-border)] px-2.5 py-1.5 text-xs text-[var(--text-dim)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
                    >
                      <Icon icon={FileText} size={13} /> Załóż wspólny dokument z tabelą lub listą zadań
                    </button>
                  )}
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
                  <Icon icon={ArrowDown} size={13} /> Najnowsze
                </button>
              )}
              <div
                data-kolumna="wiadomosci"
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
                    // Notka systemowa przerywa serię: bez tego wiadomość spod
                    // niej traciłaby nagłówek i wyglądała na ciąg dalszy tej
                    // sprzed notki.
                    prev.contentType !== "system" &&
                    m.contentType !== "system" &&
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
                          <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--glass-border)] to-[var(--glass-border)]" />
                          <span data-etykieta="dzien" className="rounded-full border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-0.5 font-[family-name:var(--font-display)] text-[11px] font-medium tracking-wide text-[var(--text-dim)] backdrop-blur-sm">
                            {formatDayLabel(new Date(m.createdAt))}
                          </span>
                          <span className="h-px flex-1 bg-gradient-to-l from-transparent via-[var(--glass-border)] to-[var(--glass-border)]" />
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
                        canPin={mozeZarzadzac(activeChannel)}
                        isSaved={savedIds.has(m.id)}
                        isFirstUnread={m.id === firstUnreadId}
                        autoEditNonce={editRequest?.id === m.id ? editRequest.nonce : 0}
                        reactionsEnabled={moduleEnabled("reactions")}
                        threadsEnabled={moduleEnabled("threads") && !activeChannel?.e2ee}
                        e2ePeerKey={activePeerKey}
                        readBy={m.id === readReceipt?.messageId ? readReceipt.readers : undefined}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div data-pasek="pisanie" className="flex h-5 items-center gap-1.5 px-4 text-xs text-[var(--text-dim)]">
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

            <form
              onSubmit={handleSend}
              className="border-t border-[var(--glass-border)] p-3"
              style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
            >
              {peerKeyChanged ? (
                <button
                  type="button"
                  onClick={() => setShowVerifyModal(true)}
                  className="mb-2 flex w-full items-center gap-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-left text-xs text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/15"
                >
                  <Icon icon={ShieldAlert} size={15} className="shrink-0" />
                  <span>
                    <span className="font-medium">Klucz szyfrowania rozmówcy się zmienił.</span>{" "}
                    Wysyłanie wstrzymane. Kliknij, aby zweryfikować numer bezpieczeństwa.
                  </span>
                </button>
              ) : activeChannel.e2ee ? (
                <div className="mb-2 flex items-center gap-1.5 text-xs text-[var(--accent-2)]">
                  <Icon icon={ShieldCheck} size={13} />
                  <span>Rozmowa szyfrowana end-to-end. Tylko Ty i rozmówca możecie odczytać wiadomości.</span>
                  {peerKeyStatus?.state === "ok" && (
                    <button
                      type="button"
                      onClick={() => setShowVerifyModal(true)}
                      className="underline decoration-dotted underline-offset-2 hover:no-underline"
                    >
                      Zweryfikuj
                    </button>
                  )}
                </div>
              ) : null}
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
                        <Icon icon={Paperclip} size={16} className="text-[var(--text-dim)]" />
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
                        className="-m-1.5 ml-1 p-1.5 text-[var(--text-dim)] transition-colors hover:text-[var(--danger)] touch:-m-2.5 touch:p-2.5"
                        aria-label="Usuń załącznik"
                      >
                        <Icon icon={X} size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {showPreview && draft.trim() && (
                <div className="mb-2 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">
                    <Icon icon={Eye} size={12} /> Podgląd
                  </div>
                  <div className="text-sm leading-snug [word-break:break-word]">
                    {renderMarkdown(draft, members, user?.id ?? "", taskSources)}
                  </div>
                </div>
              )}
              <div className="relative flex gap-2">
                {taskQuery !== null && moduleEnabled("task-refs") && (
                  <div className="animate-slide-up absolute bottom-full left-12 z-20 mb-1 w-80 overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-strong)] shadow-xl backdrop-blur-lg">
                    {taskResults.map((t) => (
                      <button
                        key={`${t.sourceKey}-${t.id}`}
                        type="button"
                        onClick={() => insertTaskRef(t)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                      >
                        <span className="min-w-0 flex-1 truncate">{t.title}</span>
                        {t.status && (
                          <span className="shrink-0 text-[11px] text-[var(--text-dim)]">{t.status}</span>
                        )}
                        <span className="shrink-0 rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--accent)]">
                          {t.sourceLabel}
                        </span>
                      </button>
                    ))}
                    {taskResults.length === 0 && (
                      <div className="px-3 py-2 text-[12.5px] text-[var(--text-dim)]">
                        {taskLoading ? "Szukam zadań…" : "Brak pasujących zadań."}
                      </div>
                    )}
                  </div>
                )}
                {(mentionCandidates.length > 0 || mentionBroadcasts.length > 0) && (
                  <div className="animate-slide-up absolute bottom-full left-12 z-20 mb-1 w-64 overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-strong)] shadow-xl backdrop-blur-lg">
                    {mentionBroadcasts.map((b) => (
                      <button
                        key={b.token}
                        type="button"
                        onClick={() => insertBroadcastMention(b.token)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                      >
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--warning)]/25 text-[10px] text-[var(--warning)]">
                          @
                        </span>
                        <span className="font-medium text-[var(--warning)]">{b.label}</span>
                        <span className="ml-auto text-[11px] text-[var(--text-dim)]">{b.desc}</span>
                      </button>
                    ))}
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
                    <div className="animate-menu-pop origin-bottom-left absolute bottom-full left-0 z-20 mb-1 w-52 overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-strong)] py-1 shadow-xl backdrop-blur-lg">
                      <button
                        type="button"
                        onClick={(e) => {
                          setComposerEmojiAnchor(e.currentTarget.getBoundingClientRect());
                          setShowComposerActions(false);
                          setShowComposerEmoji(true);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                      >
                        <Icon icon={Smile} size={16} /> Emoji
                      </button>
                      {moduleEnabled("files") && (
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
                      )}
                      {moduleEnabled("polls") && (
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
                      )}
                      {moduleEnabled("scheduling") && (
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
                      )}
                      {aiEnabled && moduleEnabled("ai") && !activeChannel.e2ee &&
                        [
                          { mode: "improve", label: "AI: Popraw ton" },
                          { mode: "shorten", label: "AI: Skróć" },
                          { mode: "translate_en", label: "AI: Przetłumacz na EN" },
                          { mode: "translate_pl", label: "AI: Przetłumacz na PL" },
                          { mode: "corpo", label: "AI: Korpo-mowa" },
                          { mode: "corpo_hard", label: "AI: Korpo-mowa (hard)" }
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
                  {/* Mobile emoji picker renders through the shared portal instance below. */}
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
                      <div className="animate-menu-pop origin-bottom-left absolute bottom-full left-0 z-20 mb-2 w-60 overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-strong)] shadow-2xl backdrop-blur-lg">
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
                              className="flex flex-1 items-center justify-center rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] py-1.5 transition-colors hover:bg-[var(--accent)]/20 active:scale-[0.94]"
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
                            setShowPreview((v) => !v);
                          }}
                          className="flex w-full items-center justify-between gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                        >
                          <span className="flex items-center gap-2.5">
                            <Icon icon={Eye} size={16} /> Podgląd na żywo
                          </span>
                          {showPreview && <Icon icon={Check} size={15} />}
                        </button>
                        <div className="border-t border-[var(--glass-border)]" />
                        <button
                          type="button"
                          onClick={(e) => {
                            setComposerEmojiAnchor(e.currentTarget.getBoundingClientRect());
                            setShowComposerMenu(false);
                            setShowComposerEmoji(true);
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent)]/15"
                        >
                          <Icon icon={Smile} size={16} /> Emoji
                        </button>
                        {moduleEnabled("files") && (
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
                        )}
                        {moduleEnabled("polls") && (
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
                        )}
                        {moduleEnabled("scheduling") && (
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
                        )}
                      </div>
                    </>
                  )}
                  {showComposerEmoji && (
                    <EmojiPicker
                      anchor={composerEmojiAnchor}
                      onPick={(emoji) => insertEmoji(emoji)}
                      onClose={() => setShowComposerEmoji(false)}
                    />
                  )}
                  {aiEnabled && moduleEnabled("ai") && !activeChannel.e2ee && (
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
                        <div className="animate-menu-pop origin-bottom-left absolute bottom-full left-0 z-20 mb-1 w-48 overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-strong)] py-1 shadow-xl backdrop-blur-lg">
                          {[
                            { mode: "improve", label: "Popraw ton" },
                            { mode: "shorten", label: "Skróć" },
                            { mode: "translate_en", label: "Przetłumacz na EN" },
                            { mode: "translate_pl", label: "Przetłumacz na PL" },
                            { mode: "corpo", label: "Korpo-mowa" },
                            { mode: "corpo_hard", label: "Korpo-mowa (hard)" }
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
                  disabled={bezPisania}
                  placeholder={
                    tylkoDoOdczytu
                      ? "Jednostronny kanał powiadomień"
                      : readOnlyAnnouncement
                        ? "Tylko administratorzy kanału mogą tu pisać"
                        : slowmodeNotice
                          ? `Napisz na #${activeChannel.name} — ${slowmodeNotice}`
                          : `Napisz na ${activeChannel.type === "DM" ? "@" : "#"}${activeChannel.name}`
                  }
                  maxLength={8000}
                  className="composer-glow min-w-0 flex-1 resize-none rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 text-sm leading-snug outline-none backdrop-blur-sm focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
                />
                {draft.length > 7000 && (
                  <span className="absolute -top-5 right-24 text-xs text-[var(--warning)]">
                    {draft.length}/8000
                  </span>
                )}
                <button
                  type="submit"
                  disabled={bezPisania || (!draft.trim() && pending.length === 0)}
                  title={
                    tylkoDoOdczytu
                      ? "Jednostronny kanał powiadomień"
                      : readOnlyAnnouncement
                        ? "Kanał ogłoszeniowy — brak uprawnień do pisania"
                        : "Wyślij"
                  }
                  className="btn-gradient flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium text-white shadow-[0_4px_16px_var(--accent-glow)] transition-all duration-150 hover:brightness-[1.06] active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 touch:min-h-11 touch:min-w-11 sm:px-4"
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
                className="text-[var(--text-dim)] hover:text-[var(--text)] touch:flex touch:min-h-11 touch:min-w-11 touch:items-center"
              >
                <Icon icon={Menu} size={18} />
              </button>
            </div>
            <div className="flex flex-1 items-center justify-center p-6">
              {channels.length === 0 ? (
                (() => {
                  const canInvite = ["OWNER", "ADMIN", "HR"].includes(
                    orgs.find((o) => o.id === activeOrgId)?.role ?? ""
                  );
                  return (
                    <div className="animate-float-in w-full max-w-md text-center">
                      <img
                        src="/icon-192.png"
                        alt=""
                        className="mx-auto mb-5 h-16 w-16 rounded-2xl shadow-lg"
                      />
                      <h2 className="text-xl font-semibold">
                        <span className="text-brand-gradient">Witaj w {orgs.find((o) => o.id === activeOrgId)?.name ?? "Chat WB-Platform"}</span>
                      </h2>
                      <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--text-dim)]">
                        Nie masz jeszcze żadnych kanałów. Kanały to miejsca, w których Twój zespół prowadzi
                        rozmowy. Zacznij od utworzenia pierwszego.
                      </p>
                      <div className="mt-6 flex flex-col gap-2.5">
                        <button
                          onClick={() => setShowCreateChannel(true)}
                          className="btn-gradient flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-[0_4px_16px_var(--accent-glow)] transition-all duration-150 hover:brightness-[1.06] active:scale-[0.98]"
                        >
                          <Icon icon={Plus} size={16} /> Utwórz pierwszy kanał
                        </button>
                        <button
                          onClick={() => setShowBrowseChannels(true)}
                          className="flex items-center justify-center gap-2 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--border)]/40"
                        >
                          <Icon icon={Search} size={16} /> Przeglądaj istniejące kanały
                        </button>
                        {canInvite && (
                          <button
                            onClick={() => navigate("/admin/members")}
                            className="flex items-center justify-center gap-2 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--border)]/40"
                          >
                            <Icon icon={Users} size={16} /> Zaproś współpracowników
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="text-center text-[var(--text-dim)]">
                  <Icon icon={Send} size={28} className="mx-auto mb-3 opacity-40" />
                  <p className="text-sm">Wybierz kanał z listy po lewej, aby rozpocząć rozmowę.</p>
                  <button
                    onClick={() => setShowBrowseChannels(true)}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-4 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--border)]/40"
                  >
                    <Icon icon={Search} size={15} /> Przeglądaj kanały
                  </button>
                </div>
              )}
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

      {showDocuments && activeChannelId && user && (
        <DocumentsPanel
          channelId={activeChannelId}
          currentUserId={user.id}
          members={members}
          onClose={() => setShowDocuments(false)}
        />
      )}

      {showOrgDocuments && activeOrgId && (
        <OrgDocumentsModal
          orgId={activeOrgId}
          onClose={() => setShowOrgDocuments(false)}
          onOpen={(channelId) => {
            // Panel dokumentów działa w kontekście kanału, więc najpierw
            // przełączamy kanał, a potem otwieramy panel.
            setActiveChannel(channelId);
            setShowOrgDocuments(false);
            setShowDocuments(true);
          }}
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
          actions={[
            { key: "a-create", label: "Utwórz kanał", icon: <Icon icon={Plus} size={14} />, onSelect: () => { setShowQuickSwitcher(false); setShowCreateChannel(true); } },
            { key: "a-browse", label: "Przeglądaj kanały", icon: <Icon icon={Search} size={14} />, onSelect: () => { setShowQuickSwitcher(false); setShowBrowseChannels(true); } },
            { key: "a-saved", label: "Zapisane wiadomości", icon: <Icon icon={Bookmark} size={14} />, onSelect: () => { setShowQuickSwitcher(false); setShowSaved(true); } },
            { key: "a-settings", label: "Ustawienia", icon: <Icon icon={Settings} size={14} />, onSelect: () => { setShowQuickSwitcher(false); navigate("/settings"); } },
            { key: "a-admin", label: "Panel administracyjny", icon: <Icon icon={Shield} size={14} />, onSelect: () => { setShowQuickSwitcher(false); navigate("/admin/members"); } },
            { key: "a-logout", label: "Wyloguj", icon: <Icon icon={LogOut} size={14} />, onSelect: () => { setShowQuickSwitcher(false); void handleLogout(); } }
          ]}
          onClose={() => setShowQuickSwitcher(false)}
        />
      )}

      {showSchedulePicker && (
        <SchedulePicker onClose={() => setShowSchedulePicker(false)} onSubmit={(iso) => void submitSchedule(iso)} />
      )}

      {showPollModal && (
        <CreatePollModal
          onClose={() => setShowPollModal(false)}
          onSubmit={(input) => void submitPoll(input)}
        />
      )}

      {showVerifyModal && peerKeyStatus && peerKeyStatus.state !== "missing" && (
        <E2eVerifyModal
          peerName={activeChannel?.name ?? "rozmówcą"}
          safetyNumber={peerKeyStatus.safetyNumber}
          changed={peerKeyStatus.state === "changed"}
          onTrust={trustChangedPeerKey}
          onClose={() => setShowVerifyModal(false)}
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
          <div className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAiSummary(null)}>
            <div
              className="glass-strong max-h-[70dvh] w-full max-w-md overflow-y-auto rounded-2xl p-5 shadow-2xl"
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
                Treść wygenerowana przez darmowy model AI. Może zawierać nieścisłości.
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
          categories={categories}
          initialCategoryId={createChannelCategoryId}
          orgMembers={members}
          currentUserId={user?.id ?? ""}
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

      {categoryModal.open && activeOrgId && (
        <CategorySettingsModal
          orgId={activeOrgId}
          category={categoryModal.category}
          orgMembers={members}
          currentUserId={user?.id ?? ""}
          onClose={() => setCategoryModal({ open: false, category: null })}
          onSaved={(saved) => {
            setCategories((prev) =>
              prev.some((c) => c.id === saved.id)
                ? prev.map((c) => (c.id === saved.id ? saved : c))
                : [...prev, saved]
            );
            setCategoryModal({ open: false, category: null });
            showToast(
              categoryModal.category
                ? `Kategoria „${saved.name}" zapisana.`
                : `Kategoria „${saved.name}" utworzona.`
            );
          }}
        />
      )}

      {settingsChannelId &&
        (() => {
          const channel = channels.find((c) => c.id === settingsChannelId);
          if (!channel) return null;
          return (
            <ChannelSettingsModal
              channel={channel}
              categories={categories}
              canManage={canManageChannels}
              initialTab={settingsInitialTab}
              membersSlot={
                <ChannelMembersTab
                  channelId={channel.id}
                  isDm={channel.type === "DM"}
                  isAdmin={mozeZarzadzac(channel)}
                  orgMembers={members}
                />
              }
              onClose={() => setSettingsChannelId(null)}
              onSaved={(patch) => {
                setChannels(channels.map((c) => (c.id === settingsChannelId ? { ...c, ...patch } : c)));
                setSettingsChannelId(null);
                showToast("Ustawienia kanału zapisane.");
              }}
              onDeleted={(channelId) => {
                setSettingsChannelId(null);
                removeChannelFromView(channelId);
                showToast("Kanał usunięty.");
              }}
            />
          );
        })()}

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

      {dialog?.kind === "prompt" && (
        <PromptDialog
          title={dialog.title}
          label={dialog.label}
          {...(dialog.initialValue !== undefined ? { initialValue: dialog.initialValue } : {})}
          {...(dialog.placeholder !== undefined ? { placeholder: dialog.placeholder } : {})}
          {...(dialog.confirmLabel !== undefined ? { confirmLabel: dialog.confirmLabel } : {})}
          onConfirm={dialog.onConfirm}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "confirm" && (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          {...(dialog.confirmLabel !== undefined ? { confirmLabel: dialog.confirmLabel } : {})}
          {...(dialog.danger !== undefined ? { danger: dialog.danger } : {})}
          {...(dialog.requirePhrase !== undefined ? { requirePhrase: dialog.requirePhrase } : {})}
          onConfirm={dialog.onConfirm}
          onCancel={() => setDialog(null)}
        />
      )}

      {inVoiceChannelId && user && (
        <VoiceRoom
          channelId={inVoiceChannelId}
          channelName={channels.find((c) => c.id === inVoiceChannelId)?.name ?? ""}
          myUserId={user.id}
          members={members}
          onClose={() => setInVoiceChannelId(null)}
          onEnded={(powod) => {
            setInVoiceChannelId(null);
            showToast(powod);
          }}
        />
      )}
    </div>
  );
}
