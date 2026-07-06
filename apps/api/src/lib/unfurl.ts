import { assertSafeUrl, SsrfBlockedError } from "./ssrf-guard.js";

const MAX_HTML_BYTES = 1 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "chatv2-linkbot/1.0 (+internal chat link preview)";

export interface UnfurlResult {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  finalUrl: string;
}

/**
 * Fetches a URL with the redirect chain fully re-validated against the
 * SSRF guard at every hop (an attacker-controlled server could otherwise
 * pass the initial check then 302 to http://169.254.169.254/...).
 * Caps response size by aborting once the byte budget is exceeded.
 */
async function safeFetch(rawUrl: string, maxBytes: number): Promise<{ body: Buffer; url: string } | null> {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const validated = await assertSafeUrl(currentUrl);

    const res = await fetch(validated.toString(), {
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,image/*;q=0.8,*/*;q=0.5" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) return null;
      currentUrl = new URL(location, validated).toString();
      continue;
    }

    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return { body: Buffer.concat(chunks), url: validated.toString() };
  }

  return null; // too many redirects
}

function extractMeta(html: string, attr: "property" | "name", key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']*)["']`,
    "i"
  );
  const reReversed = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${key}["']`,
    "i"
  );
  const match = html.match(re) ?? html.match(reReversed);
  return match ? decodeHtmlEntities(match[1] as string) : null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function unfurlUrl(rawUrl: string): Promise<UnfurlResult | null> {
  const fetched = await safeFetch(rawUrl, MAX_HTML_BYTES).catch((err) => {
    if (err instanceof SsrfBlockedError) return null;
    throw err;
  });
  if (!fetched) return null;

  const html = fetched.body.toString("utf8");
  const titleTagMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);

  return {
    title:
      extractMeta(html, "property", "og:title") ??
      extractMeta(html, "name", "twitter:title") ??
      (titleTagMatch ? decodeHtmlEntities(titleTagMatch[1]!.trim()) : null),
    description:
      extractMeta(html, "property", "og:description") ??
      extractMeta(html, "name", "twitter:description") ??
      extractMeta(html, "name", "description"),
    imageUrl:
      extractMeta(html, "property", "og:image") ?? extractMeta(html, "name", "twitter:image"),
    siteName: extractMeta(html, "property", "og:site_name"),
    finalUrl: fetched.url
  };
}

/** Downloads an OG image, re-validated against the SSRF guard. */
export async function fetchEmbedImage(imageUrl: string): Promise<Buffer | null> {
  const fetched = await safeFetch(imageUrl, MAX_IMAGE_BYTES).catch((err) => {
    if (err instanceof SsrfBlockedError) return null;
    throw err;
  });
  return fetched?.body ?? null;
}
