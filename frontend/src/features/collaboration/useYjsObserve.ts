import { useRef, useSyncExternalStore } from "react";
import type * as Y from "yjs";

/** Subscribes to any Yjs shared type (Y.Array, Y.Map, Y.Text, ...) and
 * forces a re-render whenever it changes, whether the change came from a
 * local edit or a remote CRDT update. Uses useSyncExternalStore since Yjs is
 * exactly the kind of external mutable store that hook exists for. The
 * version counter only needs to change on every event, not carry meaning. */
export function useYjsObserve<T>(type: Y.AbstractType<T> | undefined): void {
  const version = useRef(0);

  useSyncExternalStore(
    (onStoreChange) => {
      if (!type) return () => {};
      const handler = () => {
        version.current += 1;
        onStoreChange();
      };
      type.observe(handler);
      return () => type.unobserve(handler);
    },
    () => version.current,
  );
}
