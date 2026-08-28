"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileTextIcon, SearchIcon } from "@/components/ui/icons";
import { useAuth } from "@/features/auth/AuthProvider";
import { isApiError } from "@/lib/api-error";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { searchDocuments } from "./api";
import styles from "./SearchDialog.module.css";
import type { DocumentSearchResult } from "./types";

const DEBOUNCE_MS = 250;

/**
 * Renders a ts_headline snippet (default `<b>...</b>` markers around
 * matched terms) as React text nodes, never via dangerouslySetInnerHTML.
 * Document content is arbitrary user text and Postgres's ts_headline does
 * not HTML-escape it - splitting on the known marker and letting React
 * render each segment as a text child keeps any literal "<script>" (or
 * other markup) a user typed in their document inert, always displayed as
 * plain text rather than parsed as HTML.
 */
function renderSnippet(snippet: string): ReactNode[] {
  const parts = snippet.split(/(<b>|<\/b>)/);
  const nodes: ReactNode[] = [];
  let bold = false;
  let key = 0;
  for (const part of parts) {
    if (part === "<b>") {
      bold = true;
      continue;
    }
    if (part === "</b>") {
      bold = false;
      continue;
    }
    if (!part) continue;
    nodes.push(
      bold ? <mark key={key++}>{part}</mark> : <span key={key++}>{part}</span>,
    );
  }
  return nodes;
}

/** Only ever rendered by the parent while `open` is true (a fresh mount
 * per open), so all state below already starts at its "just opened"
 * default - no reset-on-open effect needed. */
export function SearchDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const { apiFetch } = useAuth();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, onClose);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocumentSearchResult[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("ready");
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setPhase("loading");
      searchDocuments(apiFetch, workspaceId, trimmed)
        .then((data) => {
          if (cancelled) return;
          setResults(data);
          setActiveIndex(0);
          setPhase("ready");
          setError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(isApiError(err) ? err.message : "Search failed.");
          setPhase("error");
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, apiFetch, workspaceId]);

  function goTo(result: DocumentSearchResult) {
    onClose();
    router.push(`/workspace/${workspaceId}/document/${result.id}`);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = results[activeIndex];
      if (result) goTo(result);
    }
  }

  const trimmedQuery = query.trim();

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Search documents"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.inputRow}>
          <SearchIcon className={styles.inputIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder="Search documents…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className={styles.escHint}>Esc</kbd>
        </div>

        <div className={styles.results}>
          {!trimmedQuery ? (
            <p className={styles.hint}>Start typing to search this workspace.</p>
          ) : phase === "loading" ? (
            <p className={styles.hint}>Searching…</p>
          ) : phase === "error" ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : results.length === 0 ? (
            <p className={styles.hint}>No documents match &ldquo;{trimmedQuery}&rdquo;.</p>
          ) : (
            <ul className={styles.list}>
              {results.map((result, index) => (
                <li key={result.id}>
                  <button
                    type="button"
                    className={
                      index === activeIndex ? styles.itemActive : styles.item
                    }
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => goTo(result)}
                  >
                    <FileTextIcon className={styles.itemIcon} width={15} height={15} />
                    <span className={styles.itemBody}>
                      <span className={styles.itemTitle}>{result.title}</span>
                      {result.snippet ? (
                        <span className={styles.itemSnippet}>
                          {renderSnippet(result.snippet)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
