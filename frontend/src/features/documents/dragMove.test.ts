import { describe, expect, it } from "vitest";
import {
  computeOptimisticMove,
  isSelfOrDescendant,
  resolveDragEndMove,
  resolveDropZone,
} from "./dragMove";
import { ROOT_DROP_ZONE_ID } from "./dragTypes";
import type { DocumentNode } from "./types";

function doc(overrides: Partial<DocumentNode>): DocumentNode {
  return {
    id: "doc",
    workspaceId: "ws-1",
    parentId: null,
    title: "Untitled",
    position: 1000,
    createdById: "user-1",
    archivedAt: null,
    isPublished: false,
    publicSlug: null,
    publishedAt: null,
    publicAccessMode: "view",
    publicExpiresAt: null,
    restricted: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isSelfOrDescendant", () => {
  it("is true for the node itself", () => {
    const docs = [doc({ id: "a" })];
    expect(isSelfOrDescendant(docs, "a", "a")).toBe(true);
  });

  it("is true for a direct child", () => {
    const docs = [doc({ id: "a" }), doc({ id: "b", parentId: "a" })];
    expect(isSelfOrDescendant(docs, "a", "b")).toBe(true);
  });

  it("is true for a grandchild", () => {
    const docs = [
      doc({ id: "a" }),
      doc({ id: "b", parentId: "a" }),
      doc({ id: "c", parentId: "b" }),
    ];
    expect(isSelfOrDescendant(docs, "a", "c")).toBe(true);
  });

  it("is false for an unrelated document", () => {
    const docs = [doc({ id: "a" }), doc({ id: "b" })];
    expect(isSelfOrDescendant(docs, "a", "b")).toBe(false);
  });

  it("is false for a document's own parent (not a descendant)", () => {
    const docs = [doc({ id: "a" }), doc({ id: "b", parentId: "a" })];
    expect(isSelfOrDescendant(docs, "b", "a")).toBe(false);
  });
});

describe("resolveDropZone", () => {
  // Target row spans y=100..132 (height 32).
  it("resolves to 'before' when the dragged item is in the top quarter", () => {
    expect(resolveDropZone(102, 100, 32)).toBe("before");
  });

  it("resolves to 'after' when the dragged item is in the bottom quarter", () => {
    expect(resolveDropZone(130, 100, 32)).toBe("after");
  });

  it("resolves to 'inside' when the dragged item is over the middle half", () => {
    expect(resolveDropZone(116, 100, 32)).toBe("inside");
  });
});

describe("resolveDragEndMove", () => {
  const docs = [
    doc({ id: "a", position: 1000 }),
    doc({ id: "x", parentId: "a", position: 1000 }),
    doc({ id: "b", position: 2000 }),
    doc({ id: "c", position: 3000 }),
  ];

  it("reorders a root sibling before another root sibling", () => {
    expect(resolveDragEndMove(docs, "b", { id: "a", zone: "before" })).toEqual({
      parentId: null,
      referenceId: "a",
      placement: "before",
    });
  });

  it("moves a child into another parent and back to root", () => {
    expect(resolveDragEndMove(docs, "x", { id: "b", zone: "inside" })).toEqual({
      parentId: "b",
    });
    expect(resolveDragEndMove(docs, "x", { id: ROOT_DROP_ZONE_ID, zone: "inside" })).toEqual({
      parentId: null,
    });
  });

  it("rejects self and descendant targets", () => {
    expect(resolveDragEndMove(docs, "a", { id: "a", zone: "inside" })).toBeNull();
    expect(resolveDragEndMove(docs, "a", { id: "x", zone: "inside" })).toBeNull();
  });

  it("does not submit an already-adjacent sibling placement", () => {
    expect(resolveDragEndMove(docs, "b", { id: "a", zone: "after" })).toBeNull();
  });
});

describe("computeOptimisticMove", () => {
  it("appends to the end of the new parent's children when no reference is given", () => {
    const docs = [
      doc({ id: "root" }),
      doc({ id: "a", parentId: "root", position: 1000 }),
      doc({ id: "b", parentId: "root", position: 2000 }),
      doc({ id: "moved", position: 1000 }),
    ];

    const result = computeOptimisticMove(docs, "moved", "root");
    const moved = result.find((d) => d.id === "moved")!;
    expect(moved.parentId).toBe("root");
    expect(moved.position).toBeGreaterThan(2000);
  });

  it("places the node between two siblings for a 'before' placement", () => {
    const docs = [
      doc({ id: "a", position: 1000 }),
      doc({ id: "b", position: 2000 }),
      doc({ id: "moved", position: 3000 }),
    ];

    const result = computeOptimisticMove(docs, "moved", null, "b", "before");
    const moved = result.find((d) => d.id === "moved")!;
    expect(moved.position).toBeGreaterThan(1000);
    expect(moved.position).toBeLessThan(2000);
  });

  it("places the node after the reference when it is the last sibling", () => {
    const docs = [doc({ id: "a", position: 1000 }), doc({ id: "moved", position: 2000 })];

    const result = computeOptimisticMove(docs, "moved", null, "a", "after");
    const moved = result.find((d) => d.id === "moved")!;
    expect(moved.position).toBeGreaterThan(1000);
  });

  it("moves the node to root with no parent", () => {
    const docs = [doc({ id: "root" }), doc({ id: "moved", parentId: "root" })];

    const result = computeOptimisticMove(docs, "moved", null);
    expect(result.find((d) => d.id === "moved")!.parentId).toBeNull();
  });

  it("leaves every other document untouched", () => {
    const docs = [
      doc({ id: "a", position: 1000 }),
      doc({ id: "b", position: 2000 }),
      doc({ id: "moved", position: 3000 }),
    ];

    const result = computeOptimisticMove(docs, "moved", null, "a", "after");
    expect(result.find((d) => d.id === "a")).toEqual(docs[0]);
    expect(result.find((d) => d.id === "b")).toEqual(docs[1]);
  });
});
