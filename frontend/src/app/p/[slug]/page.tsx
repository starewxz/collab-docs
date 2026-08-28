import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverEnv } from "@/config/env";
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

export default async function PublicDocumentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = await fetchPublicDocument(slug);

  if (!doc) {
    notFound();
  }

  return (
    <main className={styles.page}>
      <article>
        <h1 className={styles.title}>{doc.title}</h1>
        <PublicDocumentView blocks={doc.blocks} />
      </article>
    </main>
  );
}
