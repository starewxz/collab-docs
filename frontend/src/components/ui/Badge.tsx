import type { HTMLAttributes } from "react";
import styles from "./Badge.module.css";

type BadgeVariant = "neutral" | "accent" | "danger" | "warning" | "outline";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = "neutral", className, ...props }: BadgeProps) {
  const classes = [styles.badge, styles[variant], className].filter(Boolean).join(" ");
  return <span className={classes} {...props} />;
}
