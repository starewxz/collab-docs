export interface PublicBlock {
  id: string;
  type: string;
  text?: string;
  checked?: boolean;
  level?: number;
  language?: string;
  imageUrl?: string;
  imageAlt?: string;
}

export interface PublicDocument {
  title: string;
  blocks: PublicBlock[];
  publishedAt: string;
  mode: "view" | "edit";
}
