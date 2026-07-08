import type { MessageDto, PresenceDto, LinkEmbedDto } from "./dto.js";

// Single source of truth for Socket.IO event names, shared client <-> server.

export const WS_CLIENT_EVENTS = {
  MessageSend: "message:send",
  MessageEdit: "message:edit",
  MessageDelete: "message:delete",
  ReactionToggle: "reaction:toggle",
  TypingStart: "typing:start",
  TypingStop: "typing:stop",
  ReadMark: "read:mark",
  PresenceSet: "presence:set",
  VoiceJoin: "voice:join",
  VoiceLeave: "voice:leave",
  VoiceOffer: "voice:offer",
  VoiceAnswer: "voice:answer",
  VoiceIce: "voice:ice",
  VoiceMute: "voice:mute"
} as const;

export const WS_SERVER_EVENTS = {
  MessageNew: "message:new",
  MessageUpdated: "message:updated",
  MessageDeleted: "message:deleted",
  TypingUpdate: "typing:update",
  PresenceUpdate: "presence:update",
  ChannelCreated: "channel:created",
  ChannelMemberJoined: "channel:member-joined",
  FileStatus: "file:status",
  FilePreview: "file:preview",
  MessageEmbeds: "message:embeds",
  ReactionUpdate: "reaction:update",
  ReadUpdate: "read:update",
  PollUpdate: "poll:update",
  VoiceParticipants: "voice:participants",
  VoiceOffer: "voice:offer",
  VoiceAnswer: "voice:answer",
  VoiceIce: "voice:ice",
  VoicePeerLeft: "voice:peer-left",
  VoiceMuteUpdate: "voice:mute-update",
  Error: "error"
} as const;

export interface ClientToServerEvents {
  [WS_CLIENT_EVENTS.MessageSend]: (payload: {
    channelId: string;
    tempId: string;
    content: string;
    fileIds?: string[];
    parentId?: string;
  }) => void;
  [WS_CLIENT_EVENTS.MessageEdit]: (payload: {
    messageId: string;
    content: string;
  }) => void;
  [WS_CLIENT_EVENTS.MessageDelete]: (payload: { messageId: string }) => void;
  [WS_CLIENT_EVENTS.ReactionToggle]: (payload: {
    messageId: string;
    emoji: string;
  }) => void;
  [WS_CLIENT_EVENTS.TypingStart]: (payload: { channelId: string }) => void;
  [WS_CLIENT_EVENTS.TypingStop]: (payload: { channelId: string }) => void;
  [WS_CLIENT_EVENTS.ReadMark]: (payload: {
    channelId: string;
    messageId: string;
  }) => void;
  [WS_CLIENT_EVENTS.PresenceSet]: (payload: { status: "online" | "away" | "dnd" }) => void;
  [WS_CLIENT_EVENTS.VoiceJoin]: (payload: { channelId: string }) => void;
  [WS_CLIENT_EVENTS.VoiceLeave]: (payload: { channelId: string }) => void;
  [WS_CLIENT_EVENTS.VoiceOffer]: (payload: { channelId: string; toUserId: string; sdp: string }) => void;
  [WS_CLIENT_EVENTS.VoiceAnswer]: (payload: { channelId: string; toUserId: string; sdp: string }) => void;
  [WS_CLIENT_EVENTS.VoiceIce]: (payload: { channelId: string; toUserId: string; candidate: string }) => void;
  [WS_CLIENT_EVENTS.VoiceMute]: (payload: { channelId: string; muted: boolean }) => void;
}

export interface ServerToClientEvents {
  [WS_SERVER_EVENTS.MessageNew]: (payload: MessageDto) => void;
  [WS_SERVER_EVENTS.MessageUpdated]: (payload: MessageDto) => void;
  [WS_SERVER_EVENTS.MessageDeleted]: (payload: {
    messageId: string;
    channelId: string;
  }) => void;
  [WS_SERVER_EVENTS.TypingUpdate]: (payload: {
    channelId: string;
    userId: string;
    isTyping: boolean;
  }) => void;
  [WS_SERVER_EVENTS.PresenceUpdate]: (payload: PresenceDto) => void;
  [WS_SERVER_EVENTS.ChannelCreated]: (payload: { channelId: string }) => void;
  [WS_SERVER_EVENTS.ChannelMemberJoined]: (payload: {
    channelId: string;
    userId: string;
  }) => void;
  [WS_SERVER_EVENTS.FileStatus]: (payload: {
    fileId: string;
    channelId: string;
    status: "CLEAN" | "INFECTED" | "FAILED";
  }) => void;
  [WS_SERVER_EVENTS.FilePreview]: (payload: {
    fileId: string;
    channelId: string;
    previewStatus: "READY" | "FAILED";
  }) => void;
  [WS_SERVER_EVENTS.MessageEmbeds]: (payload: {
    messageId: string;
    embeds: LinkEmbedDto[];
  }) => void;
  [WS_SERVER_EVENTS.ReactionUpdate]: (payload: {
    messageId: string;
    channelId: string;
    reactions: import("./dto.js").ReactionGroupDto[];
  }) => void;
  [WS_SERVER_EVENTS.PollUpdate]: (payload: {
    messageId: string;
    channelId: string;
    poll: import("./schemas/productivity.js").PollDto;
  }) => void;
  [WS_SERVER_EVENTS.ReadUpdate]: (payload: {
    channelId: string;
    userId: string;
    readAt: string;
  }) => void;
  [WS_SERVER_EVENTS.VoiceParticipants]: (payload: {
    channelId: string;
    participants: { userId: string; muted: boolean }[];
  }) => void;
  [WS_SERVER_EVENTS.VoiceOffer]: (payload: { channelId: string; fromUserId: string; sdp: string }) => void;
  [WS_SERVER_EVENTS.VoiceAnswer]: (payload: { channelId: string; fromUserId: string; sdp: string }) => void;
  [WS_SERVER_EVENTS.VoiceIce]: (payload: { channelId: string; fromUserId: string; candidate: string }) => void;
  [WS_SERVER_EVENTS.VoicePeerLeft]: (payload: { channelId: string; userId: string }) => void;
  [WS_SERVER_EVENTS.VoiceMuteUpdate]: (payload: { channelId: string; userId: string; muted: boolean }) => void;
  [WS_SERVER_EVENTS.Error]: (payload: { code: string; message: string }) => void;
}
