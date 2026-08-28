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
  createdAt: string;
  updatedAt: string;
}

export type DocumentPlacement = "before" | "after";
