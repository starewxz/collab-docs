"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { LogoutButton } from "@/features/auth/LogoutButton";
import { listWorkspaces } from "./api";
import type { Workspace } from "./types";
import styles from "./WorkspaceSwitcher.module.css";

export function WorkspaceSwitcher() {
  const { apiFetch, status } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const pathname = usePathname();
  const currentWorkspaceId = pathname.startsWith("/workspace/")
    ? pathname.split("/")[2]
    : undefined;

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    listWorkspaces(apiFetch)
      .then((data) => {
        if (!cancelled) setWorkspaces(data);
      })
      .catch(() => {
        if (!cancelled) setWorkspaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch, status]);

  return (
    <nav className={styles.bar}>
      <Link href="/workspace" className={styles.brand}>
        Collab Docs
      </Link>
      <div className={styles.list}>
        {(workspaces ?? []).map((workspace) => (
          <Link
            key={workspace.id}
            href={`/workspace/${workspace.id}`}
            className={
              workspace.id === currentWorkspaceId ? styles.itemActive : styles.item
            }
          >
            {workspace.name}
          </Link>
        ))}
        <Link href="/workspace" className={styles.newLink}>
          + New workspace
        </Link>
      </div>
      <LogoutButton />
    </nav>
  );
}
