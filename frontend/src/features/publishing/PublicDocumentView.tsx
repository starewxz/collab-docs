import type { ReactNode } from "react";
import { sanitizeUrl } from "./sanitize";
import type { PublicBlock } from "./types";
import styles from "./PublicDocumentView.module.css";

/**
 * Read-only renderer for the Stage 4 block model. Deliberately not a
 * variant of the editable `BlockView`/`CollaborativeEditor` - there is no
 * Yjs, no `canEdit`, no event handlers, just plain block data -> plain
 * HTML. Every piece of text is rendered as ordinary JSX children (never
 * `dangerouslySetInnerHTML`), so React's built-in escaping is the XSS
 * defense; `sanitizeUrl` covers the one place an untrusted value becomes
 * an attribute instead of text (the image `src`).
 */
export function PublicDocumentView({ blocks }: { blocks: PublicBlock[] }) {
  if (blocks.length === 0) {
    return <p className={styles.empty}>This document is empty.</p>;
  }

  const elements: ReactNode[] = [];
  let bulletBuffer: PublicBlock[] = [];

  function flushBullets() {
    if (bulletBuffer.length === 0) return;
    elements.push(
      <ul key={`list-${elements.length}`} className={styles.list}>
        {bulletBuffer.map((block) => (
          <li key={block.id}>{block.text}</li>
        ))}
      </ul>,
    );
    bulletBuffer = [];
  }

  for (const block of blocks) {
    if (block.type === "bulletListItem") {
      bulletBuffer.push(block);
      continue;
    }
    flushBullets();

    if (block.type === "heading") {
      elements.push(
        <h2 key={block.id} className={styles.heading}>
          {block.text}
        </h2>,
      );
    } else if (block.type === "checkbox") {
      elements.push(
        <div key={block.id} className={styles.checkboxRow}>
          <input type="checkbox" checked={Boolean(block.checked)} disabled readOnly />
          <span>{block.text}</span>
        </div>,
      );
    } else if (block.type === "codeBlock") {
      elements.push(
        <pre key={block.id} className={styles.code}>
          <code>{block.text}</code>
        </pre>,
      );
    } else if (block.type === "image") {
      const src = sanitizeUrl(block.imageUrl);
      if (src) {
        elements.push(
          // eslint-disable-next-line @next/next/no-img-element -- external/unknown-origin URLs, not eligible for next/image optimization
          <img key={block.id} src={src} alt={block.imageAlt ?? ""} className={styles.image} />,
        );
      }
    } else {
      elements.push(
        <p key={block.id} className={styles.paragraph}>
          {block.text}
        </p>,
      );
    }
  }
  flushBullets();

  return <div className={styles.wrapper}>{elements}</div>;
}
