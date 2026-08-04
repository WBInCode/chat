import { z } from "zod";

/**
 * Wzmianki o zadaniach z pozostałych aplikacji ekosystemu (F8). Czat nie
 * przechowuje zadań — pyta o nie aplikację źródłową w chwili pisania, a w
 * treści wiadomości zostaje sam odnośnik.
 */

const adresHttp = z
  .string()
  .trim()
  .url()
  .max(300)
  .refine((v) => /^https?:\/\//i.test(v), { message: "Dozwolone tylko adresy http i https" });

export const createTaskSourceSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,32}$/, "Klucz może zawierać tylko małe litery, cyfry i myślnik"),
  label: z.string().trim().min(1).max(40),
  /** Adres wyszukiwarki zadań w aplikacji źródłowej. */
  searchUrl: adresHttp,
  secret: z.string().trim().min(8).max(200),
  /**
   * Wzór adresu zadania. Odnośnik plakietki budujemy z niego, a NIE z treści
   * wiadomości — inaczej autor wiadomości mógłby podstawić dowolny adres pod
   * plakietkę wyglądającą na firmową.
   */
  taskUrlTemplate: adresHttp.refine((v) => v.includes("{id}"), {
    message: "Wzór adresu musi zawierać {id}"
  })
});
export type CreateTaskSourceInput = z.infer<typeof createTaskSourceSchema>;

export const updateTaskSourceSchema = z.object({
  label: z.string().trim().min(1).max(40).optional(),
  searchUrl: adresHttp.optional(),
  secret: z.string().trim().min(8).max(200).optional(),
  taskUrlTemplate: adresHttp
    .refine((v) => v.includes("{id}"), { message: "Wzór adresu musi zawierać {id}" })
    .optional(),
  enabled: z.boolean().optional()
});
export type UpdateTaskSourceInput = z.infer<typeof updateTaskSourceSchema>;

/** Widok źródła dla administratora. Sekret nigdy nie opuszcza serwera. */
export interface TaskSourceDto {
  id: string;
  key: string;
  label: string;
  searchUrl: string;
  taskUrlTemplate: string;
  enabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Widok dla klienta: tyle, ile trzeba, żeby zbudować odnośnik plakietki. */
export interface TaskSourceLinkDto {
  key: string;
  label: string;
  taskUrlTemplate: string;
}

/**
 * Odpowiedź aplikacji źródłowej. Identyfikator ograniczamy do znaków, które
 * przechodzą przez format wzmianki — dłuższy lub dziwny odpadnie tutaj,
 * zamiast rozjechać treść wiadomości.
 */
export const taskProviderResponseSchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/),
        title: z.string().trim().min(1).max(200),
        status: z.string().trim().max(40).nullish()
      })
    )
    .max(25)
});

export interface TaskSearchResult {
  sourceKey: string;
  sourceLabel: string;
  id: string;
  title: string;
  status: string | null;
  url: string;
}

/**
 * Format wzmianki w treści wiadomości: `!{klucz|id|tytuł}`.
 *
 * Treść wiadomości to zwykły tekst, więc odnośnik musi się w niej zmieścić.
 * Zapisujemy klucz źródła i identyfikator, a nie gotowy adres — adres powstaje
 * dopiero przy renderowaniu, ze wzoru skonfigurowanego przez administratora.
 */
export const TASK_REF_PATTERN = /!\{([a-z0-9-]{1,32})\|([A-Za-z0-9_-]{1,64})\|([^}|\n]{1,120})\}/;

/** Globalny wariant do dzielenia treści — osobny obiekt, bo `g` niesie stan. */
export function taskRefRegexGlobal(): RegExp {
  return new RegExp(TASK_REF_PATTERN.source, "g");
}

/** Tytuł nie może zawierać znaków rozdzielających, bo rozerwałyby wzmiankę. */
export function sanitizeTaskRefTitle(title: string): string {
  return title.replace(/[{}|\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function formatTaskRef(sourceKey: string, taskId: string, title: string): string {
  return `!{${sourceKey}|${taskId}|${sanitizeTaskRefTitle(title)}}`;
}

/** Podstawia identyfikator we wzorze adresu, zawsze w postaci bezpiecznej dla URL. */
export function buildTaskUrl(template: string, taskId: string): string {
  return template.split("{id}").join(encodeURIComponent(taskId));
}
