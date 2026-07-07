import type { ReactNode } from "react";

interface MemberLite {
  userId: string;
  displayName: string;
}

const URL_REGEX = /https?:\/\/[^\s<>"'`]+/gi;

/**
 * Auto-links bare URLs in plain-text segments (e.g. a pasted YouTube link)
 * as clickable `<a>` tags — separate from the async LinkEmbed preview card
 * (F2-4), which only shows up later once the unfurl worker fetches OG
 * metadata. Without this, a pasted URL rendered as inert plain text until
 * the embed card appeared, which is confusing (looks unclickable).
 */
function renderLinks(text: string, keyPrefix: string): ReactNode[] {
  if (!text.includes("http://") && !text.includes("https://")) return [text];

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  const regex = new RegExp(URL_REGEX);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const url = match[0];
    nodes.push(
      <a
        key={`${keyPrefix}u${key++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="break-all text-[var(--accent)] underline decoration-1 underline-offset-2 hover:opacity-80"
      >
        {url}
      </a>
    );
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/**
 * Renders message content with @mention highlighting. Mentions are matched
 * against the actual member list (not a free regex), so "@random text"
 * without a matching user renders as plain text — no false positives.
 */
export function renderMentions(
  content: string,
  members: MemberLite[],
  currentUserId: string,
  keyPrefix = ""
): ReactNode[] {
  if (!content.includes("@")) return renderLinks(content, keyPrefix);

  const sorted = [...members].sort((a, b) => b.displayName.length - a.displayName.length);
  const nodes: ReactNode[] = [];
  let rest = content;
  let key = 0;

  while (rest.length > 0) {
    const at = rest.indexOf("@");
    if (at === -1) {
      nodes.push(...renderLinks(rest, `${keyPrefix}e${key++}-`));
      break;
    }
    const match = sorted.find((m) =>
      rest.slice(at + 1).toLowerCase().startsWith(m.displayName.toLowerCase())
    );
    if (!match) {
      nodes.push(...renderLinks(rest.slice(0, at + 1), `${keyPrefix}e${key++}-`));
      rest = rest.slice(at + 1);
      continue;
    }
    if (at > 0) nodes.push(...renderLinks(rest.slice(0, at), `${keyPrefix}e${key++}-`));
    const isMe = match.userId === currentUserId;
    nodes.push(
      <span
        key={`${keyPrefix}m-${key++}`}
        className={`rounded px-1 font-medium ${
          isMe
            ? "bg-[var(--warning)]/25 text-[var(--warning)]"
            : "bg-[var(--accent)]/15 text-[var(--accent)]"
        }`}
      >
        @{match.displayName}
      </span>
    );
    rest = rest.slice(at + 1 + match.displayName.length);
  }

  return nodes;
}

/**
 * Inline markdown: **bold**, *italic* / _italic_, ~~strike~~, `code`.
 * Works on plain-text segments; mention highlighting is applied to the
 * text BETWEEN formatting tokens. Everything is emitted as React elements
 * — user content is never parsed as HTML, so there is no injection path.
 */
function renderInline(
  text: string,
  members: MemberLite[],
  currentUserId: string,
  keyPrefix: string
): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Token regex: inline code wins over other styles; no nesting support
  // (deliberate — keeps the parser simple and predictable).
  const token = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(~~[^~]+~~)/;
  let rest = text;
  let i = 0;

  while (rest.length > 0) {
    const match = token.exec(rest);
    if (!match || match.index === undefined) {
      nodes.push(...renderMentions(rest, members, currentUserId, `${keyPrefix}t${i}-`));
      break;
    }
    if (match.index > 0) {
      nodes.push(
        ...renderMentions(rest.slice(0, match.index), members, currentUserId, `${keyPrefix}t${i}-`)
      );
    }
    const tok = match[0];
    const key = `${keyPrefix}f${i++}`;
    if (tok.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-[var(--border)]/60 px-1 py-0.5 font-mono text-[12px]">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("**")) {
      nodes.push(<strong key={key}>{renderInline(tok.slice(2, -2), members, currentUserId, `${key}-`)}</strong>);
    } else if (tok.startsWith("~~")) {
      nodes.push(<del key={key}>{renderInline(tok.slice(2, -2), members, currentUserId, `${key}-`)}</del>);
    } else {
      nodes.push(<em key={key}>{renderInline(tok.slice(1, -1), members, currentUserId, `${key}-`)}</em>);
    }
    rest = rest.slice(match.index + tok.length);
  }

  return nodes;
}

/**
 * Block-level markdown for chat messages: ```code fences```, > quotes,
 * - / * bullet lists, 1. numbered lists; everything else is a paragraph
 * line with inline formatting. Returns an array of React block elements.
 */
export function renderMarkdown(
  content: string,
  members: MemberLite[],
  currentUserId: string
): ReactNode[] {
  const blocks: ReactNode[] = [];
  const lines = content.split("\n");
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block.
    if (line.trimStart().startsWith("```")) {
      const fence: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith("```")) {
        fence.push(lines[i]!);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        <pre
          key={`b${blockKey++}`}
          className="my-1 overflow-x-auto rounded-lg border border-[var(--glass-border)] bg-[var(--border)]/40 p-2 font-mono text-[12px] leading-snug"
        >
          {fence.join("\n")}
        </pre>
      );
      continue;
    }

    // Quote block (consecutive > lines).
    if (line.trimStart().startsWith("> ") || line.trim() === ">") {
      const quote: string[] = [];
      while (i < lines.length && (lines[i]!.trimStart().startsWith("> ") || lines[i]!.trim() === ">")) {
        quote.push(lines[i]!.trimStart().replace(/^> ?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={`b${blockKey++}`}
          className="my-1 border-l-2 border-[var(--accent)]/60 pl-2 text-[var(--text-dim)]"
        >
          {quote.map((q, qi) => (
            <div key={qi}>{renderInline(q, members, currentUserId, `b${blockKey}q${qi}-`)}</div>
          ))}
        </blockquote>
      );
      continue;
    }

    // Bullet list.
    if (/^\s*[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*] /, ""));
        i++;
      }
      blocks.push(
        <ul key={`b${blockKey++}`} className="my-0.5 list-disc space-y-0.5 pl-5">
          {items.map((item, ii) => (
            <li key={ii}>{renderInline(item, members, currentUserId, `b${blockKey}l${ii}-`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list.
    if (/^\s*\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\. /.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+\. /, ""));
        i++;
      }
      blocks.push(
        <ol key={`b${blockKey++}`} className="my-0.5 list-decimal space-y-0.5 pl-5">
          {items.map((item, ii) => (
            <li key={ii}>{renderInline(item, members, currentUserId, `b${blockKey}o${ii}-`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Plain paragraph line (empty lines become spacing).
    if (line.trim() === "") {
      blocks.push(<div key={`b${blockKey++}`} className="h-1.5" />);
    } else {
      blocks.push(
        <div key={`b${blockKey++}`}>{renderInline(line, members, currentUserId, `b${blockKey}p-`)}</div>
      );
    }
    i++;
  }

  return blocks;
}
