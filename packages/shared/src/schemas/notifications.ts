import { z } from "zod";

export const notifyModeSchema = z.enum(["ALL", "MENTIONS", "NONE"]);
export type NotifyModeDto = z.infer<typeof notifyModeSchema>;

export const setNotifyModeSchema = z.object({
  mode: notifyModeSchema
});
export type SetNotifyModeInput = z.infer<typeof setNotifyModeSchema>;

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
