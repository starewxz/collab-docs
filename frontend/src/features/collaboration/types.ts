export type BlockType =
  | "paragraph"
  | "heading"
  | "bulletListItem"
  | "checkbox"
  | "codeBlock"
  | "image";

export interface PresenceUser {
  id: string;
  name: string;
  color: string;
}

export interface CollabJoinedPayload {
  documentId: string;
  canEdit: boolean;
  role: string;
  self: { id: string; name: string };
}
