export interface TextDiff {
  start: number;
  deleteLength: number;
  insertText: string;
}

/**
 * Computes the minimal prefix/suffix-trimmed diff between two plain
 * strings, for turning a controlled <textarea>'s onChange into a small
 * Y.Text delete+insert instead of replacing the whole block on every
 * keystroke. Not a general LCS diff - common-prefix/common-suffix trimming
 * is enough for single-cursor typing and is O(n), which is what a per-block
 * textarea binding needs.
 */
export function computeTextDiff(oldValue: string, newValue: string): TextDiff {
  let prefixLength = 0;
  const maxPrefix = Math.min(oldValue.length, newValue.length);
  while (prefixLength < maxPrefix && oldValue[prefixLength] === newValue[prefixLength]) {
    prefixLength++;
  }

  let suffixLength = 0;
  const maxSuffix = Math.min(oldValue.length, newValue.length) - prefixLength;
  while (
    suffixLength < maxSuffix &&
    oldValue[oldValue.length - 1 - suffixLength] === newValue[newValue.length - 1 - suffixLength]
  ) {
    suffixLength++;
  }

  return {
    start: prefixLength,
    deleteLength: oldValue.length - prefixLength - suffixLength,
    insertText: newValue.slice(prefixLength, newValue.length - suffixLength),
  };
}
