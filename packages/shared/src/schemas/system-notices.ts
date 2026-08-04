import { z } from "zod";

/**
 * Powiadomienia systemowe: jednostronny kanał od nadawcy "System" do
 * pojedynczej osoby. Nadawcami są pozostałe aplikacje ekosystemu, każda
 * z własnym tokenem, więc organizacja włącza dokładnie te produkty,
 * które posiada.
 */

/** Klucz źródła jest częścią adresu i etykiety, więc trzymamy go wąsko. */
export const systemNoticeSourceKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9-]+$/, "Tylko małe litery, cyfry i myślniki");

export const createSystemNoticeSourceSchema = z.object({
  key: systemNoticeSourceKeySchema,
  label: z.string().trim().min(1).max(60)
});
export type CreateSystemNoticeSourceInput = z.infer<typeof createSystemNoticeSourceSchema>;

export const updateSystemNoticeSourceSchema = z.object({
  enabled: z.boolean()
});

export const systemNoticePayloadSchema = z.object({
  /**
   * Odbiorcy wskazywani adresem e-mail, bo to jedyna tożsamość wspólna dla
   * całego ekosystemu (logowanie z huba zakłada konta właśnie po adresie).
   * Adresy spoza organizacji są pomijane, a nie odrzucają całej paczki.
   */
  recipients: z.array(z.string().trim().email()).min(1).max(200),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(2000).default(""),
  /** Odnośnik do miejsca zdarzenia w aplikacji źródłowej. */
  url: z.string().trim().url().max(500).optional()
});
export type SystemNoticePayload = z.infer<typeof systemNoticePayloadSchema>;

export interface SystemNoticeSourceDto {
  id: string;
  key: string;
  label: string;
  enabled: boolean;
  noticeCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  /** Zwracany wyłącznie tuż po utworzeniu i nigdy więcej. */
  token?: string;
}

/** Adres, pod który aplikacja źródłowa wysyła powiadomienia. */
export function systemNoticeEndpoint(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/v1/system-notices/${token}`;
}
