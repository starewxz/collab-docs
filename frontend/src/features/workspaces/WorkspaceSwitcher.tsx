"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { LogoutButton } from "@/features/auth/LogoutButton";
import { NotificationsBell } from "@/features/notifications/NotificationsBell";
import { SearchDialog } from "@/features/search/SearchDialog";
import { listWorkspaces } from "./api";
import type { Workspace } from "./types";
import styles from "./WorkspaceSwitcher.module.css";

export function WorkspaceSwitcher() {
  const { apiFetch, status } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
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

  useEffect(() => {
    if (!currentWorkspaceId) return;
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentWorkspaceId]);

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
      {currentWorkspaceId ? (
        <button
          type="button"
          className={styles.searchButton}
          onClick={() => setSearchOpen(true)}
          title="Search documents (Ctrl/Cmd+K)"
        >
          🔍 Search
          <span className={styles.shortcutHint}>⌘K</span>
        </button>
      ) : null}
      <NotificationsBell />
      <LogoutButton />
      {currentWorkspaceId && searchOpen ? (
        <SearchDialog
          workspaceId={currentWorkspaceId}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
    </nav>
  );
}
