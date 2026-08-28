import { useCallback, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import { computeTextDiff } from "./textDiff";

/** Binds a plain controlled-input value to a Y.Text via prefix/suffix
 * diffing, so keystrokes become small Y.Text delete+insert ops (merging
 * correctly with concurrent remote edits) instead of replacing the whole
 * block's text on every change. Uses useSyncExternalStore, the React-
 * sanctioned way to subscribe to an external mutable store like Yjs without
 * the render/effect purity issues of mirroring it into useState. */
export function useYText(ytext: Y.Text | undefined): [string, (next: string) => void] {
  const value = useSyncExternalStore(
    (onStoreChange) => {
      if (!ytext) return () => {};
      ytext.observe(onStoreChange);
      return () => ytext.unobserve(onStoreChange);
    },
    () => ytext?.toString() ?? "",
  );

  const setLocalValue = useCallback(
    (next: string) => {
      if (!ytext) return;
      const diff = computeTextDiff(ytext.toString(), next);
      if (diff.deleteLength === 0 && diff.insertText === "") return;
      ytext.doc!.transact(() => {
        if (diff.deleteLength > 0) ytext.delete(diff.start, diff.deleteLength);
        if (diff.insertText) ytext.insert(diff.start, diff.insertText);
      });
    },
    [ytext],
  );

  return [value, setLocalValue];
}
