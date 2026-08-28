import styles from "./Skeleton.module.css";

interface SkeletonProps {
  width?: string;
  height?: string;
  radius?: string;
  className?: string;
}

export function Skeleton({ width = "100%", height = "16px", radius, className }: SkeletonProps) {
  const classes = [styles.skeleton, className].filter(Boolean).join(" ");
  return (
    <span
      className={classes}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}
