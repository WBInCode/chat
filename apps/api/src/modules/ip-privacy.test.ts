import { describe, it, expect } from "vitest";
import { anonymizeIp } from "../lib/ip-privacy.js";

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
