import { ROOT_DROP_ZONE_ID, type DropZone } from "./dragTypes";
import type { DocumentNode, DocumentPlacement } from "./types";

const POSITION_STEP = 1000;

/** Splits a droppable row into three vertical bands based on where the
 * dragged item's center currently sits relative to it: the top/bottom
 * quarters reorder as a sibling before/after that row, the middle half
 * reparents as a child of it. Mirrors the common "Notion-style" tree DnD
 * affordance without needing per-pixel drop targets. */
export function resolveDropZone(
  draggedRectTop: number,
  draggedRectHeight: number,
  targetRectTop: number,
  targetRectHeight: number,
): DropZone {
  const draggedCenter = draggedRectTop + draggedRectHeight / 2;
  const relative = (draggedCenter - targetRectTop) / targetRectHeight;
  if (relative < 0.25) return "before";
  if (relative > 0.75) return "after";
  return "inside";
}

/** True if `candidateId` is `ancestorId` itself or anywhere in its
 * descendant chain - used to block a drag-and-drop move that would drop a
 * document onto (or under) one of its own descendants before ever sending
 * the request (the backend rejects this too, but a client-side check keeps
 * an obviously-invalid drop from flashing an optimistic update first). */
export function isSelfOrDescendant(
  documents: DocumentNode[],
  ancestorId: string,
  candidateId: string,
): boolean {
  if (ancestorId === candidateId) return true;
  const byId = new Map(documents.map((d) => [d.id, d]));
  let current = byId.get(candidateId);
  const maxDepth = documents.length + 1;
  for (let i = 0; i < maxDepth && current?.parentId; i++) {
    if (current.parentId === ancestorId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

/** Mirrors the backend's fractional-position placement logic
 * (DocumentsService.computePosition) closely enough to render the tree in
 * its new shape immediately after a drop, before the server round-trip
 * confirms it - the follow-up reload() replaces this with the authoritative
 * position, so exact precision doesn't matter here, only correct ordering. */
export function computeOptimisticMove(
  documents: DocumentNode[],
  nodeId: string,
  parentId: string | null,
  referenceId?: string,
  placement?: DocumentPlacement,
): DocumentNode[] {
  const siblings = documents
    .filter((d) => d.parentId === parentId && d.id !== nodeId)
    .sort((a, b) => a.position - b.position);

  let position: number;
  const reference = referenceId ? siblings.find((s) => s.id === referenceId) : undefined;

  if (!reference) {
    const last = siblings.at(-1);
    position = (last?.position ?? 0) + POSITION_STEP;
  } else {
    const index = siblings.indexOf(reference);
    if (placement === "before") {
      const prev = siblings[index - 1];
      position = prev ? (prev.position + reference.position) / 2 : reference.position - POSITION_STEP;
    } else {
      const next = siblings[index + 1];
      position = next ? (reference.position + next.position) / 2 : reference.position + POSITION_STEP;
    }
  }

  return documents.map((d) => (d.id === nodeId ? { ...d, parentId, position } : d));
}

export interface ResolvedMove {
  parentId: string | null;
  referenceId?: string;
  placement?: DocumentPlacement;
}

/** Turns a raw drop target (the root zone, or a specific row + zone) into
 * the `{parentId, referenceId, placement}` shape the move API expects, or
 * `null` if the drop is a no-op (dropped back where it already is) or
 * would create a cycle (dropping onto itself or one of its own
 * descendants). Pulled out of DocumentSidebar's drag-end handler so the
 * targeting decision is unit-testable without simulating a real pointer
 * drag through @dnd-kit. */
export function resolveDragEndMove(
  documents: DocumentNode[],
  nodeId: string,
  target: { id: string; zone: DropZone },
): ResolvedMove | null {
  const moved = documents.find((d) => d.id === nodeId);
  if (!moved) return null;

  if (target.id === ROOT_DROP_ZONE_ID) {
    if (moved.parentId === null) return null;
    return { parentId: null };
  }

  if (isSelfOrDescendant(documents, nodeId, target.id)) return null;

  if (target.zone === "inside") {
    return { parentId: target.id };
  }

  const targetNode = documents.find((d) => d.id === target.id);
  if (!targetNode) return null;
  return { parentId: targetNode.parentId, referenceId: target.id, placement: target.zone };
}
