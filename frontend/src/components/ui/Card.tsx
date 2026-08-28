import type { HTMLAttributes } from "react";
import styles from "./Card.module.css";

type CardPadding = "none" | "sm" | "md" | "lg";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  interactive?: boolean;
}

export function Card({
  className,
  padding = "md",
  interactive = false,
  ...props
}: CardProps) {
  const classes = [
    styles.card,
    styles[`pad-${padding}`],
    interactive ? styles.interactive : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <div className={classes} {...props} />;
}
