"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, Menu, MenuItem } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { NotificationsBell } from "@/features/notifications/NotificationsBell";
import { listWorkspaces } from "./api";
import type { Workspace } from "./types";
import styles from "./WorkspaceSwitcher.module.css";

/** Only ever mounted after Cmd/Ctrl+K or the search button - most sessions
 * never open it, so its code shouldn't ship in the top-nav's own chunk. */
const SearchDialog = dynamic(
  () => import("@/features/search/SearchDialog").then((m) => m.SearchDialog),
  { ssr: false },
);

export function WorkspaceSwitcher() {
  const { apiFetch, status, user, logout } = useAuth();
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const pathname = usePathname();
  const currentWorkspaceId = pathname.startsWith("/workspace/")
    ? pathname.split("/")[2]
    : undefined;
  const currentWorkspace = workspaces?.find((w) => w.id === currentWorkspaceId);

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

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      router.push("/login");
    }
  }

  const fullName = user ? `${user.firstName} ${user.lastName}`.trim() : "";

  return (
    <nav className={styles.bar} aria-label="Workspace navigation">
      <Link href="/workspace" className={styles.brand} aria-label="Collab Docs home">
        <span className={styles.brandMark} aria-hidden="true">C</span>
        <span className={styles.brandLabel}>Collab Docs</span>
      </Link>

      <Menu
        align="start"
        trigger={({ onClick, ...triggerProps }) => (
          <button type="button" className={styles.switcherTrigger} onClick={onClick} {...triggerProps}>
            <span className={styles.switcherLabel}>{currentWorkspace?.name ?? "Workspaces"}</span>
            <span className={styles.chevron} aria-hidden="true">⌄</span>
          </button>
        )}
      >
        <div className={styles.menuHeading}>Your workspaces</div>
        {(workspaces ?? []).map((workspace) => (
          <Link key={workspace.id} href={`/workspace/${workspace.id}`} className={styles.menuLink}>
            {workspace.name}
            {workspace.id === currentWorkspaceId ? (
              <span className={styles.menuCheck} aria-hidden="true">✓</span>
            ) : null}
          </Link>
        ))}
        <Link href="/workspace" className={styles.menuLinkAccent}>
          + New workspace
        </Link>
      </Menu>

      <div className={styles.spacer} />

      {currentWorkspaceId ? (
        <button
          type="button"
          className={styles.searchButton}
          onClick={() => setSearchOpen(true)}
          aria-label="Search documents (Ctrl/Cmd+K)"
          title="Search documents (Ctrl/Cmd+K)"
        >
          <SearchIcon />
          <span className={styles.searchLabel}>Search</span>
          <span className={styles.shortcutHint}>⌘K</span>
        </button>
      ) : null}

      <NotificationsBell />

      <Menu
        trigger={({ onClick, ...triggerProps }) => (
          <button
            type="button"
            className={styles.accountTrigger}
            onClick={onClick}
            aria-label="Account menu"
            {...triggerProps}
          >
            <Avatar name={fullName || user?.email || "?"} size="sm" />
          </button>
        )}
      >
        <div className={styles.menuHeading}>{fullName || "Account"}</div>
        {user?.email ? <div className={styles.menuEmail}>{user.email}</div> : null}
        <MenuItem danger onClick={handleLogout} disabled={loggingOut}>
          {loggingOut ? "Logging out…" : "Log out"}
        </MenuItem>
      </Menu>

      {currentWorkspaceId && searchOpen ? (
        <SearchDialog
          workspaceId={currentWorkspaceId}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
    </nav>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 11L14.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
