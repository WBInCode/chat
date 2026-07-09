import { z } from "zod";

/**
 * Module registry (F7). Every larger chat feature is a module that can be
 * toggled per organization. Keys are the shared contract between the API,
 * the web client, and the wb-platform Hub (Entitlements API returns the
 * enabled subset of these keys). Keep keys stable — they are persisted and
 * exchanged across services.
 */
export const MODULE_KEYS = [
  // Core — always on, cannot be disabled.
  "messaging",
  "presence",
  "admin",
  // Optional — toggleable per organization.
  "voice",
  "ai",
  "files",
  "polls",
  "threads",
  "scheduling",
  "reminders",
  "search",
  "reactions",
  "integrations",
  "e2ee",
  "analytics"
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleMeta {
  key: ModuleKey;
  label: string;
  description: string;
  /** Core modules are always enabled and not shown as toggleable. */
  core: boolean;
}

export const MODULE_CATALOG: Record<ModuleKey, ModuleMeta> = {
  messaging: { key: "messaging", label: "Wiadomości", description: "Kanały, wiadomości bezpośrednie, wiadomości.", core: true },
  presence: { key: "presence", label: "Obecność", description: "Status online oraz wskaźnik pisania.", core: true },
  admin: { key: "admin", label: "Administracja", description: "Panel administracyjny, role i uprawnienia.", core: true },
  voice: { key: "voice", label: "Rozmowy głosowe", description: "Kanały głosowe / wideo w czasie rzeczywistym.", core: false },
  ai: { key: "ai", label: "Asystent AI", description: "Podsumowania, przeredagowanie, korpo-tłumacz, bot @AI.", core: false },
  files: { key: "files", label: "Pliki i załączniki", description: "Obrazy, wideo, dokumenty i podglądy.", core: false },
  polls: { key: "polls", label: "Ankiety", description: "Głosowania w kanałach.", core: false },
  threads: { key: "threads", label: "Wątki", description: "Odpowiedzi w wątkach pod wiadomościami.", core: false },
  scheduling: { key: "scheduling", label: "Wysyłka zaplanowana", description: "Planowanie wiadomości na później.", core: false },
  reminders: { key: "reminders", label: "Przypomnienia", description: "Przypomnienia o wiadomościach.", core: false },
  search: { key: "search", label: "Wyszukiwarka", description: "Pełnotekstowe wyszukiwanie wiadomości.", core: false },
  reactions: { key: "reactions", label: "Reakcje", description: "Reakcje emoji na wiadomościach.", core: false },
  integrations: { key: "integrations", label: "Integracje", description: "Webhooki przychodzące (CI, monitoring) do kanałów.", core: false },
  e2ee: { key: "e2ee", label: "Szyfrowanie E2EE", description: "Szyfrowanie end-to-end wiadomości bezpośrednich.", core: false },
  analytics: { key: "analytics", label: "Analityka", description: "Analityka workspace dla administratorów.", core: false }
};

export const CORE_MODULE_KEYS = MODULE_KEYS.filter((k) => MODULE_CATALOG[k].core);
export const OPTIONAL_MODULE_KEYS = MODULE_KEYS.filter((k) => !MODULE_CATALOG[k].core);

/** Default state: everything on, so nothing disappears without explicit opt-out. */
export const DEFAULT_MODULE_STATE: Record<ModuleKey, boolean> = Object.fromEntries(
  MODULE_KEYS.map((k) => [k, true])
) as Record<ModuleKey, boolean>;

export const moduleKeySchema = z.enum(MODULE_KEYS);

/** Payload for an admin toggling a single optional module. */
export const setModuleSchema = z.object({
  key: z.enum(OPTIONAL_MODULE_KEYS as [ModuleKey, ...ModuleKey[]]),
  enabled: z.boolean()
});
export type SetModuleInput = z.infer<typeof setModuleSchema>;

export type ModuleState = Record<ModuleKey, boolean>;

/** Admin toggles view: catalog + current state + override source. */
export interface AdminModuleDto {
  key: ModuleKey;
  label: string;
  description: string;
  core: boolean;
  enabled: boolean;
  source: "core" | "local" | "hub" | "default";
}
