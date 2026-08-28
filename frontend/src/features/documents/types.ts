export type PublicAccessMode = "view" | "edit";

export interface DocumentNode {
  id: string;
  workspaceId: string;
  parentId: string | null;
  title: string;
  position: number;
  createdById: string;
  archivedAt: string | null;
  isPublished: boolean;
  publicSlug: string | null;
  publishedAt: string | null;
  publicAccessMode: PublicAccessMode;
  publicExpiresAt: string | null;
  restricted: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DocumentPlacement = "before" | "after";
