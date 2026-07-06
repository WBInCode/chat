import { describe, it, expect } from "vitest";
import { isBlockedIp, assertSafeUrl, SsrfBlockedError } from "../lib/ssrf-guard.js";

describe("SSRF guard — IP range blocking", () => {
  it.each([
    ["127.0.0.1", true],
    ["127.0.0.53", true],
    ["10.0.0.1", true],
    ["172.16.5.5", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false], // just outside the 172.16.0.0/12 block
    ["192.168.1.1", true],
    ["169.254.169.254", true], // cloud metadata endpoint — must be blocked
    ["100.64.0.5", true], // CGNAT
    ["0.0.0.0", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["93.184.216.34", false]
  ])("isBlockedIp(%s) === %s", (ip, expected) => {
    expect(isBlockedIp(ip)).toBe(expected);
  });

  it("blocks IPv6 loopback and unique-local addresses", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd12:3456::1")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 addresses pointing at private ranges", () => {
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:192.168.1.1")).toBe(true);
  });
});

describe("SSRF guard — assertSafeUrl", () => {
  it("rejects direct IP literals in blocked ranges", async () => {
    await expect(assertSafeUrl("http://127.0.0.1/admin")).rejects.toThrow(SsrfBlockedError);
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      SsrfBlockedError
    );
    await expect(assertSafeUrl("http://192.168.1.1/")).rejects.toThrow(SsrfBlockedError);
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(SsrfBlockedError);
    await expect(assertSafeUrl("ftp://example.com/")).rejects.toThrow(SsrfBlockedError);
  });

  it("rejects non-default ports (no internal port scanning via unfurl)", async () => {
    await expect(assertSafeUrl("http://example.com:8080/")).rejects.toThrow(SsrfBlockedError);
    await expect(assertSafeUrl("http://example.com:6379/")).rejects.toThrow(SsrfBlockedError);
  });

  it("allows a public hostname on the default port", async () => {
    const url = await assertSafeUrl("https://example.com/path");
    expect(url.hostname).toBe("example.com");
  });
});
