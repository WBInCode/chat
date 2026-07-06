// Public-facing DTOs shared between API and web. These intentionally
// exclude sensitive fields (passwordHash, totpSecret, refreshHash, ...).
import type { FileDto } from "./schemas/file.js";
export type { FileDto };

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  role: "OWNER" | "ADMIN" | "HR" | "MEMBER";
}

export interface ChannelDto {
  id: string;
  orgId: string;
  type: "PUBLIC" | "PRIVATE" | "DM";
  name: string | null;
  createdBy: string;
  createdAt: string;
  unreadCount?: number;
  myRole?: "ADMIN" | "MEMBER";
}

export interface MessageDto {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  contentType: "text" | "file" | "image" | "system";
  parentId: string | null;
  editedAt: string | null;
  createdAt: string;
  tempId?: string;
  files?: FileDto[];
  embeds?: LinkEmbedDto[];
  reactions?: ReactionGroupDto[];
  replyCount?: number;
  pinnedAt?: string | null;
}

export interface SavedMessageDto {
  savedAt: string;
  message: MessageDto;
}

export interface ReactionGroupDto {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface LinkEmbedDto {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  hasImage: boolean;
}

export interface PresenceDto {
  userId: string;
  status: "online" | "away" | "dnd" | "offline";
  lastSeenAt: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
