"use client";

import styles from "./Tabs.module.css";

interface TabItem {
  id: string;
  label: string;
  badge?: React.ReactNode;
}

interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  "aria-label": string;
}

export function Tabs({ items, activeId, onChange, ...rest }: TabsProps) {
  return (
    <div className={styles.tabs} role="tablist" {...rest}>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={[styles.tab, active ? styles.active : ""].filter(Boolean).join(" ")}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}
