export interface Comment {
  id: string;
  documentId: string;
  parentCommentId: string | null;
  authorId: string;
  authorName: string | null;
  content: string;
  resolvedAt: string | null;
  resolvedById: string | null;
  editedAt: string | null;
  mentionedUserIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CommentThread extends Comment {
  replies: Comment[];
}
