import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const REFRESH_COOKIE_NAME = "refresh_token";

/**
 * Optimistic gate only: redirects to /login when there's clearly no
 * session (no refresh cookie at all). This is a UX shortcut, not
 * authorization - every protected API call is independently verified by
 * the backend regardless of what happens here. A present-but-expired or
 * revoked cookie still redirects to a page that will fail its own
 * client-side session bootstrap and prompt for login there instead.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(REFRESH_COOKIE_NAME);

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/workspace/:path*"],
};
