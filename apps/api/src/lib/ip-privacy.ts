/**
 * IP anonymization applied before ANY address is persisted (sessions, audit
 * log). Full addresses are personal data and, kept indefinitely, become a
 * movement/behaviour record of every user - exactly the kind of collateral
 * data that leaks in a breach or gets demanded wholesale.
 *
 * Truncation keeps the part that has actual operational value ("was this
 * login from a totally different network/country?") and drops the part that
 * identifies a household or a single subscriber line:
 *   IPv4  ->  last octet zeroed        (203.0.113.57  -> 203.0.113.0)
 *   IPv6  ->  truncated to a /48       (2001:db8:1:2::1 -> 2001:db8:1::)
 *
 * Same approach as GDPR-mode analytics tooling. Deliberately irreversible:
 * there is no key that turns these back into full addresses.
 */
export function anonymizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const value = ip.trim();
  if (!value) return null;

  // IPv4-mapped IPv6 (::ffff:203.0.113.57) is treated as the IPv4 it is.
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const target = mapped?.[1] ?? value;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(target)) {
    const parts = target.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }

  if (target.includes(":")) {
    // Expanding fully would be overkill; keeping the first three groups is a
    // /48, which is the standard "site" boundary in IPv6 allocations.
    const groups = target.split(":").filter(Boolean);
    if (groups.length === 0) return null;
    return `${groups.slice(0, 3).join(":")}::`;
  }

  // Unrecognised format: store nothing rather than store something identifying.
  return null;
}

/**
 * Reduces a raw User-Agent to just "browser · OS" before storage.
 *
 * The full UA string is a high-entropy fingerprint (exact versions, build
 * tags, device models) and we never actually use it: the session list only
 * ever renders the browser/OS family so a user can recognise their own
 * devices. Storing the rest is pure collateral data waiting to leak, so the
 * reduction happens at write time and the raw string is simply never kept.
 */
export function minimizeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;

  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Przeglądarka";

  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iOS/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";

  return os ? `${browser} · ${os}` : browser;
}
