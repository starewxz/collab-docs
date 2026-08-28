import type { ReactNode } from "react";
import { DocumentSidebar } from "@/features/documents/DocumentSidebar";
import styles from "./layout.module.css";

export default async function WorkspaceDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return (
    <div className={styles.layout}>
      <DocumentSidebar workspaceId={workspaceId} />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
