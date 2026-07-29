import { z } from "zod";

export const notifyModeSchema = z.enum(["ALL", "MENTIONS", "NONE"]);
export type NotifyModeDto = z.infer<typeof notifyModeSchema>;

export const setNotifyModeSchema = z.object({
  mode: notifyModeSchema
});
export type SetNotifyModeInput = z.infer<typeof setNotifyModeSchema>;

/**
 * Zakres zbiorczych powiadomień e-mail. Wysyłka jest dodatkowo zawężona
 * przez `notifyMode` i wyciszenie kanału, a mail powstaje tylko wtedy, gdy
 * odbiorca nie ma otwartej aplikacji.
 */
export const emailDigestModeSchema = z.enum(["OFF", "MENTIONS", "ALL"]);
export type EmailDigestModeDto = z.infer<typeof emailDigestModeSchema>;

export const setEmailDigestSchema = z.object({
  mode: emailDigestModeSchema
});
export type SetEmailDigestInput = z.infer<typeof setEmailDigestSchema>;

export interface NotificationPreferencesDto {
  mode: NotifyModeDto;
  emailDigest: EmailDigestModeDto;
  /** Gdy false, serwer nie ma skonfigurowanego SMTP i opcje e-mail są nieaktywne. */
  emailAvailable: boolean;
}

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  })
});
export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url()
});
export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;
