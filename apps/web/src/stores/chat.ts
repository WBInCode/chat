import { create } from "zustand";
import type { MessageDto, LinkEmbedDto, ReactionGroupDto } from "@chatv2/shared";

export interface ChannelItem {
  id: string;
  orgId: string;
  type: "PUBLIC" | "PRIVATE" | "DM";
  name: string | null;
  topic?: string | null;
  createdAt: string;
  unreadCount?: number;
  myRole?: "ADMIN" | "MEMBER";
  muted?: boolean;
  favorite?: boolean;
  lastReadAt?: string | null;
}

interface ChatState {
  activeOrgId: string | null;
  activeChannelId: string | null;
  channels: ChannelItem[];
  /** Messages per channel, oldest → newest. */
  messages: Record<string, MessageDto[]>;
  typingUsers: Record<string, Set<string>>;
  /** Per-user presence status: online / away / dnd / offline (absent = never seen / offline). */
  presenceStatus: Record<string, "online" | "away" | "dnd" | "offline">;

  setActiveOrg: (orgId: string | null) => void;
  setActiveChannel: (channelId: string | null) => void;
  setChannels: (channels: ChannelItem[]) => void;
  clearUnread: (channelId: string) => void;
  setMessages: (channelId: string, messages: MessageDto[]) => void;
  addMessage: (message: MessageDto & { tempId?: string }) => void;
  updateMessage: (message: MessageDto) => void;
  removeMessage: (channelId: string, messageId: string) => void;
  updateFileStatus: (channelId: string, fileId: string, status: "CLEAN" | "INFECTED" | "FAILED") => void;
  updatePreviewStatus: (channelId: string, fileId: string, previewStatus: "READY" | "FAILED") => void;
  addEmbeds: (messageId: string, embeds: LinkEmbedDto[]) => void;
  updateReactions: (channelId: string, messageId: string, reactions: ReactionGroupDto[]) => void;
  incrementReplyCount: (channelId: string, parentId: string) => void;
  /** Message id whose thread panel is open, or null. */
  openThreadId: string | null;
  setOpenThread: (messageId: string | null) => void;
  setTyping: (channelId: string, userId: string, isTyping: boolean) => void;
  setPresence: (userId: string, status: "online" | "away" | "dnd" | "offline") => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeOrgId: null,
  activeChannelId: null,
  channels: [],
  messages: {},
  typingUsers: {},
  presenceStatus: {},

  setActiveOrg: (orgId) => set({ activeOrgId: orgId, activeChannelId: null, channels: [] }),
  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),
  setChannels: (channels) => set({ channels }),

  clearUnread: (channelId) =>
    set((s) => ({
      channels: s.channels.map((c) =>
        c.id === channelId ? { ...c, unreadCount: 0 } : c
      )
    })),

  setMessages: (channelId, messages) =>
    set((s) => ({ messages: { ...s.messages, [channelId]: messages } })),

  addMessage: (message) =>
    set((s) => {
      const list = s.messages[message.channelId] ?? [];
      // Reconcile optimistic message by tempId, or dedupe by id.
      const withoutTemp = message.tempId
        ? list.filter((m) => m.id !== message.tempId)
        : list;
      if (withoutTemp.some((m) => m.id === message.id)) return s;
      // Bump unread badge for non-active channels (tempId = our own echo).
      const isForeign = !message.tempId && message.channelId !== s.activeChannelId;
      const channels = isForeign
        ? s.channels.map((c) =>
            c.id === message.channelId
              ? { ...c, unreadCount: (c.unreadCount ?? 0) + 1 }
              : c
          )
        : s.channels;
      return {
        channels,
        messages: { ...s.messages, [message.channelId]: [...withoutTemp, message] }
      };
    }),

  updateMessage: (message) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [message.channelId]: (s.messages[message.channelId] ?? []).map((m) =>
          m.id === message.id ? message : m
        )
      }
    })),

  removeMessage: (channelId, messageId) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: (s.messages[channelId] ?? []).filter((m) => m.id !== messageId)
      }
    })),

  addEmbeds: (messageId, embeds) =>
    set((s) => {
      const next = { ...s.messages };
      for (const channelId of Object.keys(next)) {
        next[channelId] = (next[channelId] ?? []).map((m) =>
          m.id === messageId ? { ...m, embeds: [...(m.embeds ?? []), ...embeds] } : m
        );
      }
      return { messages: next };
    }),

  openThreadId: null,
  setOpenThread: (messageId) => set({ openThreadId: messageId }),

  updateReactions: (channelId, messageId, reactions) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: (s.messages[channelId] ?? []).map((m) =>
          m.id === messageId ? { ...m, reactions } : m
        )
      }
    })),

  incrementReplyCount: (channelId, parentId) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: (s.messages[channelId] ?? []).map((m) =>
          m.id === parentId ? { ...m, replyCount: (m.replyCount ?? 0) + 1 } : m
        )
      }
    })),

  updateFileStatus: (channelId, fileId, status) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: (s.messages[channelId] ?? []).map((m) =>
          m.files?.some((f) => f.id === fileId)
            ? { ...m, files: m.files.map((f) => (f.id === fileId ? { ...f, status } : f)) }
            : m
        )
      }
    })),

  updatePreviewStatus: (channelId, fileId, previewStatus) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: (s.messages[channelId] ?? []).map((m) =>
          m.files?.some((f) => f.id === fileId)
            ? { ...m, files: m.files.map((f) => (f.id === fileId ? { ...f, previewStatus } : f)) }
            : m
        )
      }
    })),

  setTyping: (channelId, userId, isTyping) =>
    set((s) => {
      const current = new Set(s.typingUsers[channelId] ?? []);
      if (isTyping) current.add(userId);
      else current.delete(userId);
      return { typingUsers: { ...s.typingUsers, [channelId]: current } };
    }),

  setPresence: (userId, status) =>
    set((s) => ({ presenceStatus: { ...s.presenceStatus, [userId]: status } }))
}));
