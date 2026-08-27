import type { Metadata } from "next";
import { WorkspaceDashboard } from "@/features/workspaces/WorkspaceDashboard";

export const metadata: Metadata = {
  title: "Your workspaces - Collab Docs",
};

export default function WorkspacePage() {
  return <WorkspaceDashboard />;
}
