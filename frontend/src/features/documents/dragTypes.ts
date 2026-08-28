/** Where a dragged document would land relative to the hovered row:
 * "before"/"after" reorder it as a sibling, "inside" reparents it as a
 * child (appended to the end) of the hovered document. */
export type DropZone = "before" | "after" | "inside";

/** Droppable id for the always-present zone at the bottom of the tree -
 * dropping here moves the dragged document to the workspace root. */
export const ROOT_DROP_ZONE_ID = "__document-tree-root__";
