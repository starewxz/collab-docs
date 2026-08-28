import type { ReactElement } from "react";
import styles from "./Tooltip.module.css";

interface TooltipProps {
  label: string;
  children: ReactElement;
  side?: "top" | "bottom";
}

/** CSS-only tooltip: no portal/positioning JS, shown via :hover/:focus-visible
 * on the wrapped element. Keep the wrapped child a single focusable element. */
export function Tooltip({ label, children, side = "top" }: TooltipProps) {
  return (
    <span className={[styles.wrapper, styles[side]].join(" ")} data-tooltip={label}>
      {children}
    </span>
  );
}
