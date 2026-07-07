export interface ParsedSearchFilters {
  text: string;
  fromToken: string | null;
  inToken: string | null;
  hasFile: boolean;
  before: string | null;
  after: string | null;
}

const TOKEN_RE = /(from|in|has|before|after):(\S+)/gi;

/**
 * Parses Slack-style filter tokens out of a raw search string:
 * `from:@name`, `in:#channel`, `has:file`, `before:YYYY-MM-DD`,
 * `after:YYYY-MM-DD`. Everything else remains as the free-text query.
 * Name/channel resolution to real IDs happens separately (needs the live
 * member/channel lists), this only does the lexical split.
 */
export function parseSearchFilters(raw: string): ParsedSearchFilters {
  let fromToken: string | null = null;
  let inToken: string | null = null;
  let hasFile = false;
  let before: string | null = null;
  let after: string | null = null;

  const text = raw
    .replace(TOKEN_RE, (_match, key: string, value: string) => {
      const k = key.toLowerCase();
      if (k === "from") fromToken = value.replace(/^@/, "");
      else if (k === "in") inToken = value.replace(/^#/, "");
      else if (k === "has" && value.toLowerCase() === "file") hasFile = true;
      else if (k === "before") before = value;
      else if (k === "after") after = value;
      return "";
    })
    .trim()
    .replace(/\s+/g, " ");

  return { text, fromToken, inToken, hasFile, before, after };
}
