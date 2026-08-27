export const REFRESH_COOKIE_NAME = 'refresh_token';

/**
 * Path=/ (not scoped to /api/auth) is deliberate: the frontend's proxy.ts
 * runs on a different origin/port and needs to see this cookie on normal
 * page navigations to gate protected routes, which only works if the
 * cookie's path covers those requests too. It's still httpOnly + SameSite
 * so it's never readable by page JS and is only ever sent same-site.
 */
export const REFRESH_COOKIE_PATH = '/';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;
