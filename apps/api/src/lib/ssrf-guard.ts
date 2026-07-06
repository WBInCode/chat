import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard for the link-unfurl feature. A chat message can contain ANY
 * URL, including ones pointing at internal infrastructure (metadata
 * endpoints, admin panels on localhost, other containers on the Docker
 * network, etc). Before the unfurl worker ever fetches a URL, every
 * resolved IP — including every hop of a redirect chain — must pass here.
 */

const BLOCKED_V4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata lives here!)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4] // reserved
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const target = ipv4ToInt(ip);
  return BLOCKED_V4_RANGES.some(([base, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (target & mask) === (ipv4ToInt(base) & mask);
  });
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === "::1" || // loopback
    lower.startsWith("fe80:") || // link-local
    lower.startsWith("fc") || // unique local fc00::/7
    lower.startsWith("fd") ||
    lower === "::" ||
    lower.startsWith("::ffff:") // IPv4-mapped — re-check the embedded v4
  );
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedV4(ip);
  if (version === 6) {
    if (isBlockedV6(ip)) {
      const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
      return mapped ? isBlockedV4(mapped[1] as string) : true;
    }
    return false;
  }
  return true; // unparsable — fail closed
}

export class SsrfBlockedError extends Error {
  constructor(hostname: string) {
    super(`Adres docelowy jest niedozwolony: ${hostname}`);
  }
}

/** Validates scheme + resolves DNS and rejects private/internal targets. */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(url.hostname);
  }
  if (!url.port || url.port === "80" || url.port === "443") {
    // ok — only default ports allowed, no scanning arbitrary internal ports
  } else {
    throw new SsrfBlockedError(url.hostname);
  }

  const directIpVersion = isIP(url.hostname);
  const addresses =
    directIpVersion !== 0
      ? [{ address: url.hostname, family: directIpVersion as 4 | 6 }]
      : await lookup(url.hostname, { all: true });

  if (addresses.length === 0) throw new SsrfBlockedError(url.hostname);
  for (const { address } of addresses) {
    if (isBlockedIp(address)) throw new SsrfBlockedError(url.hostname);
  }

  return url;
}
