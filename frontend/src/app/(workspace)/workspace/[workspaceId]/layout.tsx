import type { ReactNode } from "react";
import { WorkspaceDetailShell } from "@/features/documents/WorkspaceDetailShell";

export default async function WorkspaceDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <WorkspaceDetailShell workspaceId={workspaceId}>{children}</WorkspaceDetailShell>;
}
