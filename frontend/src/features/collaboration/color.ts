/** The same 6-color presence palette as --presence-1..6 in globals.css,
 * kept in sync manually since CSS custom properties aren't readable here. */
const PRESENCE_PALETTE = [
  "#1f5d4a",
  "#a3521f",
  "#3d5a99",
  "#8a3f8f",
  "#b3402a",
  "#2c7a72",
];

/** Deterministic per-user color for presence cursors/badges/avatar rings,
 * picked from the shared presence palette so every collaborator's color
 * reads as intentional rather than a random hue. */
export function colorForUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return PRESENCE_PALETTE[Math.abs(hash) % PRESENCE_PALETTE.length];
}
