import { z } from "zod";

/**
 * Incoming integration webhooks (F7-I): lets an org admin create a
 * per-channel URL that external systems (CI, monitoring, forms...) can POST
 * a small JSON payload to, which is then posted into the channel as a bot.
 */

export const createIntegrationWebhookSchema = z.object({
  channelId: z.string().uuid(),
  name: z.string().trim().min(1).max(80)
});
export type CreateIntegrationWebhookInput = z.infer<typeof createIntegrationWebhookSchema>;

export const setIntegrationWebhookEnabledSchema = z.object({
  enabled: z.boolean()
});
export type SetIntegrationWebhookEnabledInput = z.infer<typeof setIntegrationWebhookEnabledSchema>;

/**
 * Payload accepted from the external system. Generic "Slack-incoming-webhook"
 * style shape: plain text plus optional attachments, so it's trivial to wire
 * up from CI/monitoring tools without any chatv2-specific client library.
 */
export const incomingWebhookPayloadSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  username: z.string().trim().min(1).max(80).optional(),
  attachments: z
    .array(
      z.object({
        title: z.string().trim().max(200).optional(),
        text: z.string().trim().max(2000).optional(),
        color: z.string().trim().max(20).optional()
      })
    )
    .max(5)
    .optional()
});
export type IncomingWebhookPayload = z.infer<typeof incomingWebhookPayloadSchema>;

export interface IntegrationWebhookDto {
  id: string;
  channelId: string;
  channelName: string | null;
  name: string;
  enabled: boolean;
  messageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  /** Only present exactly once — right after creation — never persisted plaintext. */
  token?: string;
}
