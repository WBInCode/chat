import { appPublicUrl } from "./mailer.js";

/**
 * Renderowanie podsumowania jako zapisu rozmowy, a nie listy powiadomień.
 *
 * Klienty pocztowe to nie przeglądarki: Outlook renderuje HTML silnikiem
 * Worda, Gmail wycina znaczniki <style>. Dlatego układ opiera się na
 * tabelach i stylach inline, bez flexboksa i klas. Awatary to kolorowe
 * kółka z inicjałami, dokładnie jak w aplikacji.
 */

export interface DigestMessage {
  authorId: string;
  authorName: string;
  createdAt: Date;
  /** Pusty, gdy treści nie wolno pokazać (szyfrowanie end-to-end). */
  body: string;
  /** Zastępczy opis zamiast treści, np. informacja o szyfrowaniu lub załączniku. */
  placeholder: string | null;
  mention: boolean;
}

export interface DigestChannel {
  channelId: string;
  title: string;
  isDm: boolean;
  messages: DigestMessage[];
  /** Ile wiadomości pominięto, gdy było ich więcej niż mieści podsumowanie. */
  omitted: number;
}

const PALETTE = ["#5b7cff", "#22c55e", "#f59e0b", "#e5484d", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];

function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Treść wiadomości pochodzi od użytkownika i trafia do cudzego klienta
 * pocztowego, więc każdy znak specjalny musi zostać zneutralizowany.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" });
}

function formatDay(date: Date): string {
  return date.toLocaleDateString("pl-PL", { day: "2-digit", month: "long", timeZone: "Europe/Warsaw" });
}

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const lastTwo = n % 100;
  const last = n % 10;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

export function digestSubject(channels: DigestChannel[], total: number): string {
  if (channels.length === 1) {
    const ch = channels[0]!;
    const who = ch.isDm ? ch.title : `#${ch.title}`;
    return total === 1
      ? `Nowa wiadomość od ${ch.messages[0]?.authorName ?? who}`
      : `${total} ${plural(total, "nowa wiadomość", "nowe wiadomości", "nowych wiadomości")} w ${who}`;
  }
  return `${total} ${plural(total, "nowa wiadomość", "nowe wiadomości", "nowych wiadomości")} w ${channels.length} ${plural(channels.length, "rozmowie", "rozmowach", "rozmowach")}`;
}

function messageRow(msg: DigestMessage): string {
  const color = colorForId(msg.authorId);
  const bubbleBg = msg.mention ? "#eef3ff" : "#ffffff";
  const bubbleBorder = msg.mention ? "#c7d7ff" : "#e2e5ec";

  const content = msg.placeholder
    ? `<span style="color:#5f6877;font-style:italic;">${escapeHtml(msg.placeholder)}</span>`
    : escapeHtml(msg.body).replace(/\r?\n/g, "<br>");

  return `
  <tr>
    <td style="padding:0 0 10px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td width="36" valign="top" style="padding-right:10px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="36" height="36" style="width:36px;height:36px;background-color:${color};border-radius:18px;">
              <tr>
                <td align="center" valign="middle" style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;line-height:36px;">
                  ${escapeHtml(initials(msg.authorName))}
                </td>
              </tr>
            </table>
          </td>
          <td valign="top">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;margin-bottom:3px;">
              <strong style="color:#1b1f27;">${escapeHtml(msg.authorName)}</strong>
              <span style="color:#8b93a1;font-size:12px;">&nbsp;${formatTime(msg.createdAt)}</span>
              ${msg.mention ? '<span style="color:#3d6df2;font-size:12px;font-weight:bold;">&nbsp;· wspomniano Ciebie</span>' : ""}
            </div>
            <div style="background-color:${bubbleBg};border:1px solid ${bubbleBorder};border-radius:10px;padding:9px 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#1b1f27;word-break:break-word;">
              ${content}
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function channelBlock(channel: DigestChannel): string {
  const base = appPublicUrl();
  const link = `${base}/?channel=${encodeURIComponent(channel.channelId)}`;
  const heading = channel.isDm ? escapeHtml(channel.title) : `#${escapeHtml(channel.title)}`;
  const day = channel.messages[0] ? formatDay(channel.messages[0].createdAt) : "";

  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:22px;">
    <tr>
      <td style="padding-bottom:10px;border-bottom:1px solid #e2e5ec;">
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#1b1f27;">${heading}</span>
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8b93a1;">&nbsp;·&nbsp;${escapeHtml(day)}</span>
      </td>
    </tr>
    <tr>
      <td style="padding-top:12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          ${channel.messages.map(messageRow).join("")}
        </table>
        ${
          channel.omitted > 0
            ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8b93a1;padding:2px 0 8px 46px;">oraz ${channel.omitted} ${plural(channel.omitted, "wcześniejsza wiadomość", "wcześniejsze wiadomości", "wcześniejszych wiadomości")}</div>`
            : ""
        }
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-left:46px;">
          <tr>
            <td style="background-color:#3d6df2;border-radius:999px;">
              <a href="${link}" style="display:inline-block;padding:11px 24px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px;">Otwórz rozmowę</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

export function renderDigestHtml(recipientName: string, channels: DigestChannel[], total: number): string {
  const base = appPublicUrl();
  const settingsLink = `${base}/settings`;

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(digestSubject(channels, total))}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef1f8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(digestSubject(channels, total))}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#eef1f8;padding:32px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
        <tr>
          <td style="padding:0 6px 18px 6px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="40" height="40" align="center" valign="middle" bgcolor="#3d6df2" style="border-radius:13px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;">WB</td>
                <td valign="middle" style="padding-left:12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#101322;">Chat WB Platform</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr><td>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff;border:1px solid #e3e8f4;border-radius:24px;">
        <tr>
          <td style="padding:22px 24px 6px 24px;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;color:#1b1f27;">
              Cześć ${escapeHtml(recipientName)}, masz nieprzeczytane wiadomości
            </div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5f6877;padding-top:5px;">
              Zebraliśmy je w jedno podsumowanie, żeby nie zasypywać Cię osobnymi mailami.
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 24px 4px 24px;">
            ${channels.map(channelBlock).join("")}
          </td>
        </tr>
        <tr>
          <td style="padding:6px 24px 22px 24px;border-top:1px solid #e2e5ec;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#8b93a1;padding-top:14px;">
              Dostajesz tę wiadomość, bo masz włączone powiadomienia e-mail w Chat WB Platform.
              Wysyłamy je tylko wtedy, gdy nie jesteś aktywny w aplikacji.
              <a href="${settingsLink}" style="color:#3d6df2;">Zmień ustawienia powiadomień</a>.
            </div>
          </td>
        </tr>
      </table>
        </td></tr>
        <tr>
          <td style="padding:18px 30px 0 30px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#a4aabd;">
            WB PARTNERS Sp. z o.o., ul. Juliusza Słowackiego 24/11, 35-060 Rzeszów
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function renderDigestText(recipientName: string, channels: DigestChannel[], total: number): string {
  const base = appPublicUrl();
  const lines: string[] = [
    `Cześć ${recipientName}, masz ${total} ${plural(total, "nieprzeczytaną wiadomość", "nieprzeczytane wiadomości", "nieprzeczytanych wiadomości")}.`,
    ""
  ];

  for (const channel of channels) {
    lines.push(channel.isDm ? channel.title : `#${channel.title}`);
    lines.push("-".repeat(Math.min(60, (channel.isDm ? channel.title : `#${channel.title}`).length)));
    for (const msg of channel.messages) {
      const content = msg.placeholder ?? msg.body;
      lines.push(`[${formatTime(msg.createdAt)}] ${msg.authorName}: ${content.replace(/\r?\n/g, " ")}`);
    }
    if (channel.omitted > 0) lines.push(`... oraz ${channel.omitted} wcześniejszych wiadomości`);
    lines.push(`Otwórz: ${base}/?channel=${encodeURIComponent(channel.channelId)}`);
    lines.push("");
  }

  lines.push("Ustawienia powiadomień: " + `${base}/settings`);
  return lines.join("\n");
}
