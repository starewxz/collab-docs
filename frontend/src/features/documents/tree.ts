import type { DocumentNode } from "./types";

export interface DocumentTreeNode extends DocumentNode {
  children: DocumentTreeNode[];
}

/** The backend returns a flat list ordered by position within each parent
 * group, but not grouped - this rebuilds the nested shape the sidebar
 * renders from, sorting siblings by position at every level. */
export function buildDocumentTree(documents: DocumentNode[]): DocumentTreeNode[] {
  const byParent = new Map<string | null, DocumentNode[]>();
  for (const doc of documents) {
    const siblings = byParent.get(doc.parentId) ?? [];
    siblings.push(doc);
    byParent.set(doc.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.position - b.position);
  }

  function attach(parentId: string | null): DocumentTreeNode[] {
    const children = byParent.get(parentId) ?? [];
    return children.map((doc) => ({ ...doc, children: attach(doc.id) }));
  }

  return attach(null);
}
