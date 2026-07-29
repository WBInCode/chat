import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { env } from "../config/env.js";

/**
 * SMTP wrapper mirroring the Web Push posture: when SMTP_URL is absent the
 * whole thing is a silent no-op instead of a crash, so a deployment without
 * mail configured behaves exactly like today. Sending never throws either —
 * a dead mail server must not take down a background worker.
 */

let transporter: Transporter | null = null;
let initialised = false;

function getTransporter(): Transporter | null {
  if (initialised) return transporter;
  initialised = true;
  if (!env.SMTP_URL) return null;
  transporter = nodemailer.createTransport(env.SMTP_URL, {
    // A stuck mail server should time out quickly rather than pin a worker.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000
  });
  return transporter;
}

export function isMailConfigured(): boolean {
  return !!env.SMTP_URL;
}

/** Base URL used to build links inside emails. */
export function appPublicUrl(): string {
  const configured = env.APP_PUBLIC_URL ?? env.CORS_ORIGIN.split(",")[0] ?? "";
  return configured.trim().replace(/\/+$/, "");
}

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Groups a thread in the recipient's mailbox so consecutive digests for
   * the same conversation stack instead of forming separate threads.
   */
  threadKey?: string;
}

export async function sendMail(
  log: { warn: (obj: unknown, msg: string) => void; info: (obj: unknown, msg: string) => void },
  mail: OutgoingMail
): Promise<boolean> {
  const tx = getTransporter();
  if (!tx) return false;

  try {
    await tx.sendMail({
      from: env.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      ...(mail.threadKey
        ? {
            references: [`<${mail.threadKey}@chat.wb-partners.pl>`],
            inReplyTo: `<${mail.threadKey}@chat.wb-partners.pl>`
          }
        : {}),
      headers: {
        // Marks the message as automated so mailbox providers and vacation
        // responders do not treat it as personal correspondence.
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "All"
      }
    });
    return true;
  } catch (err) {
    log.warn({ err, to: mail.to }, "Wysyłka e-maila nie powiodła się");
    return false;
  }
}
