import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Collab Docs — Write together",
  description: "A focused workspace for shared documents, live collaboration, comments, and publishing.",
};

export default async function HomePage() {
  const cookieStore = await cookies();
  if (cookieStore.has("refresh_token")) redirect("/workspace");

  return (
    <main className={styles.main}>
      <nav className={styles.nav} aria-label="Primary navigation">
        <Link className={styles.brand} href="/" aria-label="Collab Docs home">
          <span className={styles.mark} aria-hidden="true">C</span>
          <span>Collab Docs</span>
        </Link>
        <Link className={styles.loginLink} href="/login">Log in</Link>
      </nav>

      <section className={styles.hero} aria-labelledby="home-title">
        <div className={styles.copy}>
          <p className={styles.eyebrow}>A shared place for work in progress</p>
          <h1 id="home-title" className={styles.title}>Write together.<br />Stay on the same page.</h1>
          <p className={styles.subtitle}>Shape ideas with your team in real time, keep conversations beside the work, and publish when it is ready.</p>
          <div className={styles.actions}>
            <Link className={styles.primaryAction} href="/register">Create a workspace</Link>
            <Link className={styles.secondaryAction} href="/login">Continue to your workspace</Link>
          </div>
        </div>

        <div className={styles.documentPreview} aria-hidden="true">
          <div className={styles.previewRail}>
            <span className={styles.previewDot} />
            <span className={styles.previewLineShort} />
            <span className={styles.previewLine} />
            <span className={styles.previewLineMedium} />
          </div>
          <article className={styles.previewPage}>
            <span className={styles.previewLabel}>PRODUCT BRIEF</span>
            <div className={styles.previewTitle}>Autumn release</div>
            <div className={styles.previewMeta}>3 collaborators · Editing now</div>
            <div className={styles.previewRule} />
            <div className={styles.previewHeading}>What we are building</div>
            <div className={styles.previewText} />
            <div className={styles.previewTextMedium} />
            <div className={styles.previewNote}>
              <span className={styles.avatar}>M</span>
              <span>Let’s make this clearer for the whole team.</span>
            </div>
          </article>
        </div>
      </section>

      <footer className={styles.footer}>Documents, decisions, and feedback—one workspace.</footer>
    </main>
  );
}
