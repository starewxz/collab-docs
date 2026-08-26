import styles from "./Spinner.module.css";

interface SpinnerProps {
  label?: string;
}

export function Spinner({ label = "Loading" }: SpinnerProps) {
  return (
    <span className={styles.wrapper} role="status" aria-live="polite">
      <span className={styles.spinner} />
      <span className={styles.label}>{label}</span>
    </span>
  );
}
