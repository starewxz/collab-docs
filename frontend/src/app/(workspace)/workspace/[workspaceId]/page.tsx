import { WorkspaceShell } from "@/features/workspaces/WorkspaceShell";

export default async function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <WorkspaceShell workspaceId={workspaceId} />;
}
