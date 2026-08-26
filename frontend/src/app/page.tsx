import { Card } from "@/components/ui";
import { getBackendStatus } from "@/lib/backend";
import styles from "./page.module.css";

export default async function HomePage() {
  const backend = await getBackendStatus();

  return (
    <main className={styles.main}>
      <Card className={styles.card}>
        <h1 className={styles.title}>Collab Docs</h1>
        <p className={styles.subtitle}>
          Foundation stage — infrastructure and architecture only. Workspace
          and document features arrive in later stages.
        </p>
        <div className={styles.status}>
          <span
            className={
              backend.reachable ? styles.dotOnline : styles.dotOffline
            }
          />
          <span>
            Backend {backend.reachable ? `reachable (${backend.status})` : "unreachable"}
          </span>
        </div>
      </Card>
    </main>
  );
}
