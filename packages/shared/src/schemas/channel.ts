import { z } from "zod";

export const channelTypeSchema = z.enum(["PUBLIC", "PRIVATE", "DM"]);
export type ChannelType = z.infer<typeof channelTypeSchema>;

export const channelRoleSchema = z.enum(["ADMIN", "MEMBER"]);
export type ChannelRole = z.infer<typeof channelRoleSchema>;

export const channelKindSchema = z.enum(["TEXT", "ANNOUNCEMENT"]);
export type ChannelKind = z.infer<typeof channelKindSchema>;

// Polskie litery sa czescia alfabetu, wiec musza byc dozwolone. Wczesniejszy
// zakres [a-z0-9-] wycinal je po cichu przy normalizacji na froncie.
const CHANNEL_NAME_ALLOWED = "a-z0-9ąćęłńóśźż-";
const CHANNEL_NAME_PATTERN = new RegExp(`^[${CHANNEL_NAME_ALLOWED}]+$`);

/**
 * Jedno zrodlo prawdy dla nazwy kanalu. Front normalizuje tym samym kodem,
 * ktorym backend waliduje, wiec oba nie moga sie rozjechac.
 */
export function normalizeChannelName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(new RegExp(`[^${CHANNEL_NAME_ALLOWED}]`, "g"), "");
}

export const channelNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(CHANNEL_NAME_PATTERN, "Tylko małe litery, cyfry i myślniki");

export const createChannelSchema = z.object({
  name: channelNameSchema,
  type: z.enum(["PUBLIC", "PRIVATE"]),
  kind: channelKindSchema.default("TEXT"),
  categoryId: z.string().uuid().nullish(),
  // Osoby dodawane od razu przy tworzeniu kanału prywatnego. Dla kanału
  // publicznego pole jest bez znaczenia, bo dołącza cała organizacja.
  memberIds: z.array(z.string().uuid()).max(500).optional()
});
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const createDmSchema = z.object({
  targetUserId: z.string().uuid()
});
export type CreateDmInput = z.infer<typeof createDmSchema>;

export const createGroupDmSchema = z.object({
  memberUserIds: z.array(z.string().uuid()).min(2).max(20)
});
export type CreateGroupDmInput = z.infer<typeof createGroupDmSchema>;

export const addChannelMemberSchema = z.object({
  userId: z.string().uuid()
});
export type AddChannelMemberInput = z.infer<typeof addChannelMemberSchema>;

export const setChannelTopicSchema = z.object({
  topic: z.string().trim().max(250).nullable()
});
export type SetChannelTopicInput = z.infer<typeof setChannelTopicSchema>;

export const renameChannelSchema = z.object({
  name: channelNameSchema
});
export type RenameChannelInput = z.infer<typeof renameChannelSchema>;

// Zbiorcza edycja ustawień kanału z zakładki "Przegląd". Wszystkie pola
// opcjonalne — wysyłamy tylko to, co faktycznie zmieniono.
export const updateChannelSchema = z
  .object({
    name: channelNameSchema,
    topic: z.string().trim().max(250).nullable(),
    kind: channelKindSchema,
    slowmodeSeconds: z.number().int().min(0).max(21600),
    categoryId: z.string().uuid().nullable()
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Brak pól do zmiany" });
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

// Wartości slowmode oferowane w interfejsie (sekundy). 0 = wyłączony.
export const SLOWMODE_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 3600, 7200, 21600] as const;

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  private: z.boolean().default(false),
  // Osoby z dostępem do kategorii prywatnej. Twórca dopisywany jest zawsze.
  memberIds: z.array(z.string().uuid()).max(500).optional()
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    private: z.boolean(),
    memberIds: z.array(z.string().uuid()).max(500)
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Brak pól do zmiany" });
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

/** @deprecated Zastąpione przez updateCategorySchema. */
export const renameCategorySchema = z.object({ name: z.string().trim().min(1).max(60) });

// Układ listy kanałów wspólny dla całej organizacji — ustawiają go administratorzy,
// odpowiednik przeciągania kanałów i kategorii w Discordzie.
export const updateChannelLayoutSchema = z.object({
  categories: z.array(z.object({ id: z.string().uuid(), position: z.number().int().min(0) })).max(200),
  channels: z
    .array(
      z.object({
        id: z.string().uuid(),
        categoryId: z.string().uuid().nullable(),
        position: z.number().int().min(0)
      })
    )
    .max(500)
});
export type UpdateChannelLayoutInput = z.infer<typeof updateChannelLayoutSchema>;

export interface ChannelCategoryDto {
  id: string;
  orgId: string;
  name: string;
  position: number;
  private: boolean;
  /** Wypełniane tylko dla kategorii prywatnych, dla publicznych pusta lista. */
  memberIds: string[];
}

export interface BrowseChannelDto {
  id: string;
  name: string | null;
  type: "PUBLIC" | "PRIVATE";
  topic: string | null;
  memberCount: number;
  isMember: boolean;
  archivedAt: string | null;
}

export const setMutedSchema = z.object({
  muted: z.boolean()
});
export type SetMutedInput = z.infer<typeof setMutedSchema>;

export const setFavoriteSchema = z.object({
  favorite: z.boolean()
});
export type SetFavoriteInput = z.infer<typeof setFavoriteSchema>;

// Disappearing messages: allowed TTL values (seconds). null = off.
export const CHANNEL_TTL_OPTIONS = [3600, 86400, 604800, 2592000] as const;

export const setChannelTtlSchema = z.object({
  messageTtlSeconds: z
    .union([z.literal(3600), z.literal(86400), z.literal(604800), z.literal(2592000)])
    .nullable()
});
export type SetChannelTtlInput = z.infer<typeof setChannelTtlSchema>;

export const setChannelE2eSchema = z.object({
  enabled: z.boolean()
});
export type SetChannelE2eInput = z.infer<typeof setChannelE2eSchema>;
