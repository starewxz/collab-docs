import type { ButtonHTMLAttributes } from "react";
import styles from "./IconButton.module.css";

type IconButtonVariant = "default" | "danger" | "accent";
type IconButtonSize = "sm" | "md";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  active?: boolean;
}

export function IconButton({
  variant = "default",
  size = "md",
  active = false,
  className,
  ...props
}: IconButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    active ? styles.active : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <button type="button" className={classes} {...props} />;
}
