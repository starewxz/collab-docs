"use client";

import { useCallback } from "react";
import type * as Y from "yjs";
import { IconButton, Input, Tooltip } from "@/components/ui";
import { CloseIcon, ImageIcon } from "@/components/ui/icons";
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
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- external, unpredictable-domain image URLs; next/image would require configuring every collaborator's domain
            <img className={styles.imagePreview} src={imageUrl} alt={imageAlt} />
          ) : (
            <div className={styles.imagePlaceholder}>
              <ImageIcon width={20} height={20} />
              <span>Paste an image URL below</span>
            </div>
          )}
          <div className={styles.imageFields}>
            <Input
              className={styles.imageInput}
              placeholder="Image URL"
              value={imageUrl}
              readOnly={!canEdit}
              aria-label="Image URL"
              onChange={(e) => canEdit && block.set("imageUrl", e.target.value)}
            />
            <Input
              className={styles.imageInput}
              placeholder="Alt text"
              value={imageAlt}
              readOnly={!canEdit}
              aria-label="Image alt text"
              onChange={(e) => canEdit && block.set("imageAlt", e.target.value)}
            />
          </div>
        </div>
        {canEdit ? (
          <Tooltip label="Remove block">
            <IconButton
              className={styles.removeButton}
              variant="danger"
              size="sm"
              onClick={onRemove}
              aria-label="Remove image block"
            >
              <CloseIcon />
            </IconButton>
          </Tooltip>
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
    <div className={`${styles.row} ${type === "checkbox" && Boolean(block.get("checked")) ? styles.checked : ""}`}>
      {type === "bulletListItem" ? <span className={styles.bulletMarker}>•</span> : null}
      {type === "checkbox" ? (
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={Boolean(block.get("checked"))}
          disabled={!canEdit}
          aria-label={text ? `Mark "${text}" as done` : "Mark item as done"}
          onChange={() => canEdit && block.set("checked", !block.get("checked"))}
        />
      ) : null}
      <textarea
        ref={textareaRef}
        className={textareaClassName}
        rows={1}
        value={text}
        readOnly={!canEdit}
        placeholder={type === "heading" ? "Heading" : "Type something…"}
        aria-label={type === "heading" ? "Heading text" : undefined}
        onChange={handleTextChange}
      />
      {canEdit ? (
        <Tooltip label="Remove block">
          <IconButton
            className={styles.removeButton}
            size="sm"
            onClick={onRemove}
            aria-label="Remove block"
          >
            <CloseIcon />
          </IconButton>
        </Tooltip>
      ) : null}
    </div>
  );
}
