import type { ReactNode } from "react";
import { WorkspaceSwitcher } from "@/features/workspaces/WorkspaceSwitcher";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <WorkspaceSwitcher />
      <main>{children}</main>
    </div>
  );
}
