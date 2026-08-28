import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { serverEnv } from "@/config/env";
import { PublicCollaborativeEditor } from "@/features/publishing/PublicCollaborativeEditor";
import { PublicDocumentView } from "@/features/publishing/PublicDocumentView";
import type { PublicDocument } from "@/features/publishing/types";
import styles from "./page.module.css";

/** Time-based ISR fallback (covers ordinary content edits, which don't
 * individually trigger on-demand revalidation - see ADR-017); the
 * publish/unpublish/republish/archive actions themselves call
 * revalidateTag via /api/revalidate for near-immediate effect. */
export const revalidate = 60;

async function fetchPublicDocument(slug: string): Promise<PublicDocument | null> {
  const res = await fetch(
    `${serverEnv.backendInternalUrl}/api/public/documents/${encodeURIComponent(slug)}`,
    { next: { revalidate: 60, tags: [`public-doc-${slug}`] } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  return (await res.json()) as PublicDocument;
}

function excerptFrom(doc: PublicDocument): string | undefined {
  const firstText = doc.blocks.find((b) => b.text)?.text;
  if (!firstText) return undefined;
  return firstText.length > 160 ? `${firstText.slice(0, 157)}...` : firstText;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = await fetchPublicDocument(slug);

  if (!doc) {
    return { title: "Page not found", robots: { index: false, follow: false } };
  }

  const description = excerptFrom(doc);
  const canonicalPath = `/p/${slug}`;

  return {
    title: doc.title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: doc.title,
      description,
      type: "article",
      url: canonicalPath,
    },
    twitter: {
      card: "summary",
      title: doc.title,
      description,
    },
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * TT gap 4 (streaming SSR): the shell below (`PublicDocumentPage`) has no
 * data dependency of its own and renders/streams to the client
 * immediately. This component is the one part of the page that actually
 * waits on the backend fetch - wrapping just this in `<Suspense>` means
 * Next.js flushes the static shell's HTML right away and streams this
 * piece in once the fetch resolves, a real server-streamed response
 * (visible as multiple flushed chunks), not a client-side spinner masking
 * an already-complete request. `notFound()` here is safe post-stream
 * because `proxy.ts` already guarantees the slug exists before rendering
 * starts at all (see ADR-018) - this component's own `notFound()` call is
 * defense in depth, not the primary 404 mechanism.
 */
async function PublicDocumentContent({ slug }: { slug: string }) {
  const doc = await fetchPublicDocument(slug);
  if (!doc) {
    notFound();
  }

  return (
    <>
      <h1 className={styles.title}>{doc.title}</h1>
      <p className={styles.meta}>Published {formatDate(doc.publishedAt)}</p>
      <div className={styles.divider} />
      {doc.mode === "edit" ? (
        <PublicCollaborativeEditor slug={slug} />
      ) : (
        <PublicDocumentView blocks={doc.blocks} />
      )}
    </>
  );
}

function PublicDocumentSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <Skeleton width="70%" height="2.5rem" radius="8px" />
      <Skeleton width="30%" height="0.9rem" radius="4px" />
      <div className={styles.skeletonDivider} />
      <Skeleton width="100%" height="1rem" radius="4px" />
      <Skeleton width="92%" height="1rem" radius="4px" />
      <Skeleton width="96%" height="1rem" radius="4px" />
      <Skeleton width="60%" height="1rem" radius="4px" />
    </div>
  );
}

export default async function PublicDocumentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">C</span>
          Collab Docs
        </Link>
      </header>
      <main className={styles.main}>
        <article>
          <Suspense fallback={<PublicDocumentSkeleton />}>
            <PublicDocumentContent slug={slug} />
          </Suspense>
        </article>
      </main>
    </div>
  );
}
