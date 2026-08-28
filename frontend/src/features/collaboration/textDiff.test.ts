import { describe, expect, it } from "vitest";
import { computeTextDiff } from "./textDiff";

function apply(oldValue: string, diff: ReturnType<typeof computeTextDiff>): string {
  return (
    oldValue.slice(0, diff.start) +
    diff.insertText +
    oldValue.slice(diff.start + diff.deleteLength)
  );
}

describe("computeTextDiff", () => {
  it("returns a no-op diff for identical strings", () => {
    const diff = computeTextDiff("hello", "hello");
    expect(diff).toEqual({ start: 5, deleteLength: 0, insertText: "" });
  });

  it("detects an appended character", () => {
    const diff = computeTextDiff("hello", "hello!");
    expect(diff).toEqual({ start: 5, deleteLength: 0, insertText: "!" });
  });

  it("detects a prepended character", () => {
    const diff = computeTextDiff("world", "!world");
    expect(diff).toEqual({ start: 0, deleteLength: 0, insertText: "!" });
  });

  it("detects a character inserted in the middle", () => {
    const diff = computeTextDiff("helo", "hello");
    expect(apply("helo", diff)).toBe("hello");
  });

  it("detects a deletion", () => {
    const diff = computeTextDiff("hello world", "hello");
    expect(diff).toEqual({ start: 5, deleteLength: 6, insertText: "" });
  });

  it("detects a full replacement with no shared prefix/suffix", () => {
    const diff = computeTextDiff("abc", "xyz");
    expect(diff).toEqual({ start: 0, deleteLength: 3, insertText: "xyz" });
  });

  it("handles emptying the field entirely", () => {
    const diff = computeTextDiff("hello", "");
    expect(diff).toEqual({ start: 0, deleteLength: 5, insertText: "" });
  });

  it("handles typing into an empty field", () => {
    const diff = computeTextDiff("", "hello");
    expect(diff).toEqual({ start: 0, deleteLength: 0, insertText: "hello" });
  });

  it("round-trips a random-ish edit correctly via apply()", () => {
    const diff = computeTextDiff("the quick brown fox", "the slow brown fox jumps");
    expect(apply("the quick brown fox", diff)).toBe("the slow brown fox jumps");
  });

  it("does not falsely merge prefix and suffix overlap on short strings", () => {
    // "aa" -> "a": prefix/suffix overlap must not double-count the single 'a'.
    const diff = computeTextDiff("aa", "a");
    expect(apply("aa", diff)).toBe("a");
  });
});
