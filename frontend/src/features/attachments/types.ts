export type AttachmentStatus = "pending" | "ready";

export interface Attachment {
  id: string;
  documentId: string;
  filename: string;
  mimeType: string;
  size: number;
  status: AttachmentStatus;
  uploadedById: string;
  createdAt: string;
}

export interface UploadUrlResponse {
  attachment: Attachment;
  uploadUrl: string;
  expiresInSeconds: number;
}
