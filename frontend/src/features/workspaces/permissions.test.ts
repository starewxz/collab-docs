import { describe, expect, it } from "vitest";
import {
  canChangeMemberRole,
  canComment,
  canInviteMembers,
  canLeaveWorkspace,
  canModerateComments,
  canRemoveMember,
} from "./permissions";

describe("canInviteMembers (UI gating)", () => {
  it("allows OWNER and ADMIN, denies EDITOR and VIEWER", () => {
    expect(canInviteMembers("OWNER")).toBe(true);
    expect(canInviteMembers("ADMIN")).toBe(true);
    expect(canInviteMembers("EDITOR")).toBe(false);
    expect(canInviteMembers("VIEWER")).toBe(false);
  });
});

describe("canChangeMemberRole (UI gating)", () => {
  it("never shows a role control for the OWNER row", () => {
    expect(canChangeMemberRole("OWNER", "OWNER")).toBe(false);
    expect(canChangeMemberRole("ADMIN", "OWNER")).toBe(false);
  });

  it("lets OWNER manage anyone else", () => {
    expect(canChangeMemberRole("OWNER", "ADMIN")).toBe(true);
    expect(canChangeMemberRole("OWNER", "VIEWER")).toBe(true);
  });

  it("lets ADMIN manage EDITOR/VIEWER but not other ADMINs", () => {
    expect(canChangeMemberRole("ADMIN", "EDITOR")).toBe(true);
    expect(canChangeMemberRole("ADMIN", "VIEWER")).toBe(true);
    expect(canChangeMemberRole("ADMIN", "ADMIN")).toBe(false);
  });

  it("never shows role controls to EDITOR or VIEWER", () => {
    expect(canChangeMemberRole("EDITOR", "VIEWER")).toBe(false);
    expect(canChangeMemberRole("VIEWER", "EDITOR")).toBe(false);
  });
});

describe("canRemoveMember (UI gating)", () => {
  it("mirrors canChangeMemberRole's boundaries", () => {
    expect(canRemoveMember("OWNER", "OWNER")).toBe(false);
    expect(canRemoveMember("OWNER", "ADMIN")).toBe(true);
    expect(canRemoveMember("ADMIN", "ADMIN")).toBe(false);
    expect(canRemoveMember("ADMIN", "EDITOR")).toBe(true);
  });
});

describe("canLeaveWorkspace (UI gating)", () => {
  it("hides the leave button for OWNER only", () => {
    expect(canLeaveWorkspace("OWNER")).toBe(false);
    expect(canLeaveWorkspace("ADMIN")).toBe(true);
    expect(canLeaveWorkspace("EDITOR")).toBe(true);
    expect(canLeaveWorkspace("VIEWER")).toBe(true);
  });
});

describe("canComment (UI gating)", () => {
  it("allows everyone except VIEWER", () => {
    expect(canComment("OWNER")).toBe(true);
    expect(canComment("ADMIN")).toBe(true);
    expect(canComment("EDITOR")).toBe(true);
    expect(canComment("VIEWER")).toBe(false);
  });
});

describe("canModerateComments (UI gating)", () => {
  it("allows only OWNER/ADMIN", () => {
    expect(canModerateComments("OWNER")).toBe(true);
    expect(canModerateComments("ADMIN")).toBe(true);
    expect(canModerateComments("EDITOR")).toBe(false);
    expect(canModerateComments("VIEWER")).toBe(false);
  });
});
