import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { serverEnv } from "@/config/env";

const REFRESH_COOKIE_NAME = "refresh_token";

/**
 * Optimistic gate only: redirects to /login when there's clearly no
 * session (no refresh cookie at all). This is a UX shortcut, not
 * authorization - every protected API call is independently verified by
 * the backend regardless of what happens here. A present-but-expired or
 * revoked cookie still redirects to a page that will fail its own
 * client-side session bootstrap and prompt for login there instead.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/p/")) {
    return checkPublicDocumentExists(pathname);
  }

  const hasSession = request.cookies.has(REFRESH_COOKIE_NAME);

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

/**
 * The app has a root `loading.tsx`, which wraps every route (including
 * `/p/[slug]`) in an implicit Suspense boundary. That means the page's own
 * `notFound()` call - which runs the backend existence check - fires only
 * after the response shell has already streamed with a 200 status, which
 * Next.js cannot change afterward (this is documented framework behavior,
 * not a bug in the page: see Next.js docs, "Calling notFound() after
 * streaming has started"). The page still renders correct not-found UI
 * and a noindex tag either way, but callers that check the raw HTTP status
 * (monitoring, this project's own tests) need a real 404. Running the
 * existence check here, before any rendering starts, is the framework's
 * documented fix - proxy runs before the response is committed.
 */
async function checkPublicDocumentExists(pathname: string) {
  const slug = pathname.slice("/p/".length);
  if (!slug || slug.includes("/")) {
    return NextResponse.next(); // not a single-segment slug - let the route 404 normally
  }

  try {
    const res = await fetch(
      `${serverEnv.backendInternalUrl}/api/public/documents/${encodeURIComponent(slug)}`,
      { cache: "no-store" },
    );
    if (res.status === 404) {
      return new NextResponse("Not Found", {
        status: 404,
        headers: { "content-type": "text/plain" },
      });
    }
  } catch {
    // Backend unreachable - fail open (200-status caveat applies) rather
    // than taking the whole public site down on a transient backend error.
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/workspace/:path*", "/p/:path*"],
};
