import { describe, expect, it } from "vitest";
import { isSafeUrl, sanitizeUrl } from "./sanitize";

describe("isSafeUrl", () => {
  it("allows http and https URLs", () => {
    expect(isSafeUrl("https://example.com/image.png")).toBe(true);
    expect(isSafeUrl("http://example.com/image.png")).toBe(true);
  });

  it("rejects a javascript: URL", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects a data: URL", () => {
    expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects a vbscript: URL", () => {
    expect(isSafeUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(isSafeUrl("not a url")).toBe(false);
  });
});

describe("sanitizeUrl", () => {
  it("returns the URL unchanged when safe", () => {
    expect(sanitizeUrl("https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    );
  });

  it("returns null for an unsafe scheme", () => {
    expect(sanitizeUrl("javascript:alert(document.cookie)")).toBeNull();
  });

  it("returns null when undefined", () => {
    expect(sanitizeUrl(undefined)).toBeNull();
  });
});
