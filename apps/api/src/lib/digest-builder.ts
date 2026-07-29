import type { FastifyInstance } from "fastify";
import { decryptMessageContent, isOrgEncryptedAtRest } from "./message-crypto.js";
import type { DigestChannel, DigestMessage } from "./email-templates.js";
import type { DigestItem } from "./email-digest.js";

/** Ile wiadomości pokazujemy w jednym kanale, zanim przejdziemy na licznik. */
export const MAX_MESSAGES_PER_CHANNEL = 12;

/** Górna granica liczby kanałów w jednym mailu. */
const MAX_CHANNELS = 10;

export const E2E_PLACEHOLDER = "Wiadomość szyfrowana end-to-end, treść widoczna tylko w aplikacji";
export const AT_REST_PLACEHOLDER = "Nowa wiadomość, treść widoczna tylko w aplikacji";

/**
 * Zamienia zbuforowane identyfikatory na gotowe do wyrenderowania kanały.
 *
 * Tu odsiewamy wszystko, co przestało być aktualne między zebraniem
 * wiadomości a momentem wysyłki: przeczytane, usunięte, z kanałów w
 * międzyczasie wyciszonych albo opuszczonych. To jest powód, dla którego
 * decyzja o wysyłce zapada dopiero teraz, a nie przy nadejściu wiadomości.
 */
export async function buildDigestChannels(
  fastify: FastifyInstance,
  userId: string,
  items: DigestItem[]
): Promise<DigestChannel[]> {
  const byChannel = new Map<string, DigestItem[]>();
  for (const item of items) {
    const list = byChannel.get(item.channelId) ?? [];
    list.push(item);
    byChannel.set(item.channelId, list);
  }

  const result: DigestChannel[] = [];

  for (const [channelId, channelItems] of byChannel) {
    const membership = await fastify.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
      include: { channel: true }
    });
    // Wyrzucony z kanału albo kanał wyciszony po fakcie.
    if (!membership || membership.mutedAt) continue;

    const lastRead = membership.lastReadAt ?? new Date(0);
    const messages = await fastify.prisma.message.findMany({
      where: {
        id: { in: channelItems.map((i) => i.messageId) },
        deletedAt: null,
        // Przeczytane po zebraniu, ale przed wysyłką — nie ma o czym pisać.
        createdAt: { gt: lastRead }
      },
      orderBy: { createdAt: "asc" },
      include: {
        author: { select: { id: true, displayName: true } },
        files: { select: { name: true } }
      }
    });
    if (messages.length === 0) continue;

    const mentionIds = new Set(channelItems.filter((i) => i.mention).map((i) => i.messageId));
    const shown = messages.slice(-MAX_MESSAGES_PER_CHANNEL);
    const omitted = messages.length - shown.length;

    // Organizacja, która włączyła szyfrowanie bazy, świadomie zdecydowała,
    // że treść rozmów ma nie leżeć w czytelnej postaci poza aplikacją.
    // Skrzynka pocztowa to serwer, na który nie mamy żadnego wpływu i który
    // przechowuje wiadomości latami, więc mail dostaje samą informację o
    // nowej wiadomości i odnośnik.
    const hideContent = await isOrgEncryptedAtRest(fastify, membership.channel.orgId);

    const rendered: DigestMessage[] = shown.map((m) => {
      // Treść end-to-end jest zaszyfrowana kluczem, którego serwer nie ma i
      // mieć nie powinien. Do maila trafia wyłącznie informacja, że coś
      // przyszło — nigdy szyfrogram ani próba jego odczytania.
      if (m.contentType === "e2e" || membership.channel.e2ee) {
        return {
          authorId: m.author.id,
          authorName: m.author.displayName,
          createdAt: m.createdAt,
          body: "",
          placeholder: E2E_PLACEHOLDER,
          mention: mentionIds.has(m.id)
        };
      }

      if (hideContent) {
        return {
          authorId: m.author.id,
          authorName: m.author.displayName,
          createdAt: m.createdAt,
          body: "",
          placeholder: AT_REST_PLACEHOLDER,
          mention: mentionIds.has(m.id)
        };
      }

      const text = decryptMessageContent(m).trim();
      const attachment = m.files[0]?.name;
      let placeholder: string | null = null;
      if (!text) {
        placeholder = attachment ? `Załącznik: ${attachment}` : "Wiadomość bez treści";
      }

      return {
        authorId: m.author.id,
        authorName: m.author.displayName,
        createdAt: m.createdAt,
        body: text.length > 600 ? `${text.slice(0, 600)}…` : text,
        placeholder,
        mention: mentionIds.has(m.id)
      };
    });

    result.push({
      channelId,
      title:
        membership.channel.type === "DM"
          ? (rendered[0]?.authorName ?? "Wiadomość bezpośrednia")
          : (membership.channel.name ?? "kanał"),
      isDm: membership.channel.type === "DM",
      messages: rendered,
      omitted
    });
  }

  // Najpierw rozmowy ze wzmiankami, potem najbardziej aktywne.
  result.sort((a, b) => {
    const aMention = a.messages.some((m) => m.mention) ? 1 : 0;
    const bMention = b.messages.some((m) => m.mention) ? 1 : 0;
    if (aMention !== bMention) return bMention - aMention;
    return b.messages.length - a.messages.length;
  });

  return result.slice(0, MAX_CHANNELS);
}
