const SAFE_URL_SCHEMES = new Set(["http:", "https:"]);

/**
 * Published block content is untrusted (any workspace member could have
 * typed it). Block text itself is safe by construction - it's always
 * rendered as ordinary JSX children, which React escapes automatically,
 * never via dangerouslySetInnerHTML. URLs are different: an `<img src>`
 * (or any future `href`) is an attribute, not text, so a `javascript:` or
 * other non-http(s) scheme must be rejected explicitly before use.
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return SAFE_URL_SCHEMES.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function sanitizeUrl(url: string | undefined): string | null {
  if (!url) return null;
  return isSafeUrl(url) ? url : null;
}
