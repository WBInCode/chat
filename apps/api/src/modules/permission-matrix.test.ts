import { describe, it, expect } from "vitest";
import { can, type OrgRole, type OrgAction } from "../lib/authz.js";

describe("Permission matrix — can(role, action)", () => {
  const actions: OrgAction[] = [
    "member.invite",
    "member.remove",
    "member.changeRole",
    "member.deactivate",
    "channel.manage",
    "org.settings",
    "org.auditLog",
    "org.auditLogFull",
    "org.export",
    "org.transferOwnership"
  ];
  const roles: OrgRole[] = ["OWNER", "ADMIN", "HR", "MEMBER"];

  it("OWNER can do everything", () => {
    for (const action of actions) expect(can("OWNER", action)).toBe(true);
  });

  it("MEMBER can do nothing administrative", () => {
    for (const action of actions) expect(can("MEMBER", action)).toBe(false);
  });

  it("HR can manage members but not channels or org settings", () => {
    expect(can("HR", "member.invite")).toBe(true);
    expect(can("HR", "member.remove")).toBe(true);
    expect(can("HR", "member.deactivate")).toBe(true);
    expect(can("HR", "member.changeRole")).toBe(false);
    expect(can("HR", "channel.manage")).toBe(false);
    expect(can("HR", "org.settings")).toBe(false);
    expect(can("HR", "org.export")).toBe(false);
    expect(can("HR", "org.transferOwnership")).toBe(false);
  });

  it("HR sees the audit log but not the full (admin-inclusive) view", () => {
    expect(can("HR", "org.auditLog")).toBe(true);
    expect(can("HR", "org.auditLogFull")).toBe(false);
  });

  it("ADMIN can manage channels/settings but not export or transfer ownership", () => {
    expect(can("ADMIN", "channel.manage")).toBe(true);
    expect(can("ADMIN", "org.settings")).toBe(true);
    expect(can("ADMIN", "member.changeRole")).toBe(true);
    expect(can("ADMIN", "org.export")).toBe(false);
    expect(can("ADMIN", "org.transferOwnership")).toBe(false);
  });

  it("only OWNER can export org data or transfer ownership", () => {
    for (const role of roles) {
      expect(can(role, "org.export")).toBe(role === "OWNER");
      expect(can(role, "org.transferOwnership")).toBe(role === "OWNER");
    }
  });
});
