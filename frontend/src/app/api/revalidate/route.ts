import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Called by the backend's RevalidationService immediately after a
 * publish/unpublish/republish/archive-driven-unpublish, so those specific
 * state transitions are reflected without waiting out the public page's
 * time-based ISR window (see ADR-017 in the backend's docs/ai). Never
 * called by, or exposed to, the browser - protected by a shared secret
 * that only the backend knows.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { slug?: string; secret?: string }
    | null;

  const expected = process.env.REVALIDATE_SECRET;
  if (!expected || !body?.secret || body.secret !== expected) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  if (!body.slug) {
    return NextResponse.json({ message: "slug is required" }, { status: 400 });
  }

  // { expire: 0 } - called from outside a Server Action (the backend, via
  // this Route Handler), so `updateTag`'s read-your-own-writes semantics
  // aren't available; this is Next 16's documented way to force the next
  // request to be a blocking revalidate instead of serving stale content.
  revalidateTag(`public-doc-${body.slug}`, { expire: 0 });
  // Both forms: the literal path (in case this exact slug was previously
  // rendered) and the dynamic page-template pattern (the documented way to
  // invalidate a `[slug]` route when the specific cache entry for this
  // literal path may not exist yet).
  revalidatePath(`/p/${body.slug}`);
  revalidatePath("/p/[slug]", "page");

  return NextResponse.json({ revalidated: true });
}
