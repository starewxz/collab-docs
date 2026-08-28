import { describe, expect, it } from "vitest";
import { buildDocumentTree } from "./tree";
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildDocumentTree", () => {
  it("nests children under their parent", () => {
    const tree = buildDocumentTree([
      doc({ id: "root", position: 1000 }),
      doc({ id: "child", parentId: "root", position: 1000 }),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("root");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].id).toBe("child");
  });

  it("orders siblings by position ascending regardless of input order", () => {
    const tree = buildDocumentTree([
      doc({ id: "b", position: 2000 }),
      doc({ id: "a", position: 1000 }),
    ]);

    expect(tree.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("handles multiple levels of nesting", () => {
    const tree = buildDocumentTree([
      doc({ id: "root", position: 1000 }),
      doc({ id: "child", parentId: "root", position: 1000 }),
      doc({ id: "grandchild", parentId: "child", position: 1000 }),
    ]);

    expect(tree[0].children[0].children[0].id).toBe("grandchild");
  });

  it("returns an empty array for an empty document list", () => {
    expect(buildDocumentTree([])).toEqual([]);
  });
});
