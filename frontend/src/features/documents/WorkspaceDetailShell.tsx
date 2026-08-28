"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DocumentSidebar } from "./DocumentSidebar";
import styles from "./WorkspaceDetailShell.module.css";

function MenuGlyphIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  );
}

/** Client wrapper around DocumentSidebar + the routed content - the only
 * reason this needs to be a Client Component (rather than the plain
 * `<div className={styles.layout}>` the Server Component layout used to
 * render directly) is the mobile drawer's open/close state. On screens
 * ≥769px the sidebar is always visible via CSS; below that it's an
 * off-canvas drawer toggled by the menu button. */
export function WorkspaceDetailShell({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  // Navigating (e.g. picking a document from the drawer) should close it -
  // otherwise the drawer would stay open over the newly-loaded document.
  // Adjusting state during render (not in an effect) on a prop/derived
  // value change is the React-recommended pattern here - it avoids the
  // extra commit-then-effect-then-recommit round trip an effect would add.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setSidebarOpen(false);
  }

  return (
    <div className={styles.layout}>
      <button
        type="button"
        className={styles.menuButton}
        onClick={() => setSidebarOpen(true)}
        aria-label="Open document sidebar"
        aria-expanded={sidebarOpen}
        aria-controls="document-sidebar-drawer"
      >
        <MenuGlyphIcon />
        Documents
      </button>

      {sidebarOpen ? (
        <div
          className={styles.backdrop}
          onClick={() => setSidebarOpen(false)}
          role="presentation"
        />
      ) : null}

      <div
        id="document-sidebar-drawer"
        className={`${styles.sidebarWrap} ${sidebarOpen ? styles.sidebarOpen : ""}`}
      >
        <DocumentSidebar workspaceId={workspaceId} onNavigate={() => setSidebarOpen(false)} />
      </div>

      <div className={styles.content}>{children}</div>
    </div>
  );
}
