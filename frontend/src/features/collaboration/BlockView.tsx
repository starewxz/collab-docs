"use client";

import { useCallback } from "react";
import type * as Y from "yjs";
import styles from "./BlockView.module.css";
import { useYjsObserve } from "./useYjsObserve";
import { useYText } from "./useYText";
import type { BlockType } from "./types";

function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export function BlockView({
  block,
  canEdit,
  onRemove,
}: {
  block: Y.Map<unknown>;
  canEdit: boolean;
  onRemove: () => void;
}) {
  useYjsObserve(block);
  const type = block.get("type") as BlockType;
  const ytext = block.get("text") as Y.Text | undefined;
  const [text, setText] = useYText(ytext);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      autoResize(e.target);
      if (canEdit) setText(e.target.value);
    },
    [canEdit, setText],
  );

  const textareaRef = useCallback((el: HTMLTextAreaElement | null) => autoResize(el), []);

  if (type === "image") {
    const imageUrl = (block.get("imageUrl") as string) ?? "";
    const imageAlt = (block.get("imageAlt") as string) ?? "";
    return (
      <div className={styles.row}>
        <div className={styles.imageBlock}>
          <p className={styles.imagePlaceholderHint}>
            Image block (upload not implemented yet - metadata only)
          </p>
          <input
            className={styles.imageInput}
            placeholder="Image URL"
            value={imageUrl}
            readOnly={!canEdit}
            onChange={(e) => canEdit && block.set("imageUrl", e.target.value)}
          />
          <input
            className={styles.imageInput}
            placeholder="Alt text"
            value={imageAlt}
            readOnly={!canEdit}
            onChange={(e) => canEdit && block.set("imageAlt", e.target.value)}
          />
        </div>
        {canEdit ? (
          <button type="button" className={styles.removeButton} onClick={onRemove}>
            ✕
          </button>
        ) : null}
      </div>
    );
  }

  const textareaClassName =
    type === "heading"
      ? `${styles.textarea} ${styles.heading}`
      : type === "codeBlock"
        ? `${styles.textarea} ${styles.code}`
        : styles.textarea;

  return (
    <div className={styles.row}>
      {type === "bulletListItem" ? <span className={styles.bulletMarker}>•</span> : null}
      {type === "checkbox" ? (
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={Boolean(block.get("checked"))}
          disabled={!canEdit}
          onChange={() => canEdit && block.set("checked", !block.get("checked"))}
        />
      ) : null}
      <textarea
        ref={textareaRef}
        className={textareaClassName}
        rows={1}
        value={text}
        readOnly={!canEdit}
        placeholder={type === "heading" ? "Heading" : "Type something..."}
        onChange={handleTextChange}
      />
      {canEdit ? (
        <button type="button" className={styles.removeButton} onClick={onRemove} title="Remove block">
          ✕
        </button>
      ) : null}
    </div>
  );
}
