"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import styles from "./Menu.module.css";

interface MenuProps {
  trigger: (props: { onClick: () => void; "aria-expanded": boolean }) => ReactNode;
  children: ReactNode;
  align?: "start" | "end";
}

export function Menu({ trigger, children, align = "end" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useFocusTrap(containerRef, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className={styles.container} ref={containerRef}>
      {trigger({ onClick: () => setOpen((v) => !v), "aria-expanded": open })}
      {open ? (
        <div
          role="menu"
          className={[styles.menu, align === "start" ? styles.alignStart : styles.alignEnd].join(
            " ",
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  danger,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  const classes = [styles.item, danger ? styles.danger : ""].filter(Boolean).join(" ");
  return <button type="button" role="menuitem" className={classes} {...props} />;
}
