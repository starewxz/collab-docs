import { DocumentPage } from "@/features/documents/DocumentPage";

export default async function WorkspaceDocumentPage({
  params,
}: {
  params: Promise<{ workspaceId: string; documentId: string }>;
}) {
  const { workspaceId, documentId } = await params;
  return <DocumentPage workspaceId={workspaceId} documentId={documentId} />;
}
