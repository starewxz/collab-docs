export interface DocumentSearchResult {
  id: string;
  title: string;
  snippet: string | null;
  parentId: string | null;
  updatedAt: string;
}
