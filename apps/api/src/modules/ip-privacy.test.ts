import { describe, it, expect } from "vitest";
import { anonymizeIp, minimizeUserAgent } from "../lib/ip-privacy.js";

// IP addresses are personal data. These assertions pin down the exact
// truncation contract so a future refactor cannot quietly start persisting
// full addresses again.
describe("anonymizeIp", () => {
  it.each([
    ["203.0.113.57", "203.0.113.0"],
    ["8.8.8.8", "8.8.8.0"],
    ["192.168.1.255", "192.168.1.0"],
    // IPv4-mapped IPv6 is treated as the IPv4 it really is.
    ["::ffff:203.0.113.57", "203.0.113.0"]
  ])("truncates IPv4 %s -> %s", (input, expected) => {
    expect(anonymizeIp(input)).toBe(expected);
  });

  it.each([
    ["2001:db8:1:2:3:4:5:6", "2001:db8:1::"],
    ["2a00:1450:4001:80f::200e", "2a00:1450:4001::"]
  ])("truncates IPv6 %s to a /48 (%s)", (input, expected) => {
    expect(anonymizeIp(input)).toBe(expected);
  });

  it("returns null for empty/unknown input rather than storing something identifying", () => {
    expect(anonymizeIp(null)).toBeNull();
    expect(anonymizeIp(undefined)).toBeNull();
    expect(anonymizeIp("")).toBeNull();
    expect(anonymizeIp("   ")).toBeNull();
    expect(anonymizeIp("not-an-ip")).toBeNull();
  });

  it("never returns the original full address", () => {
    for (const ip of ["203.0.113.57", "2001:db8:1:2:3:4:5:6"]) {
      expect(anonymizeIp(ip)).not.toBe(ip);
    }
  });
});

// The raw User-Agent is a high-entropy fingerprint we never actually use;
// only the browser/OS family is ever displayed. These assertions keep the
// stored value reduced to exactly that.
describe("minimizeUserAgent", () => {
  const CHROME_WIN =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const SAFARI_IOS =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

  it("reduces a full UA to browser + OS only", () => {
    expect(minimizeUserAgent(CHROME_WIN)).toBe("Chrome · Windows");
    expect(minimizeUserAgent(SAFARI_IOS)).toBe("Safari · iOS");
  });

  it("drops version numbers and build tags entirely", () => {
    const out = minimizeUserAgent(CHROME_WIN)!;
    expect(out).not.toMatch(/\d/); // no version digits survive
    expect(out.length).toBeLessThan(30);
  });

  it("returns null for missing input", () => {
    expect(minimizeUserAgent(null)).toBeNull();
    expect(minimizeUserAgent(undefined)).toBeNull();
    expect(minimizeUserAgent("")).toBeNull();
  });
});
