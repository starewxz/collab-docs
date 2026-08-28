import type { HTMLAttributes } from "react";
import styles from "./Avatar.module.css";

type AvatarSize = "xs" | "sm" | "md";

interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  name: string;
  color?: string;
  size?: AvatarSize;
  ring?: boolean;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  color,
  size = "md",
  ring = false,
  className,
  style,
  ...props
}: AvatarProps) {
  const classes = [styles.avatar, styles[size], ring ? styles.ring : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={classes}
      style={{
        background: color ?? "var(--color-accent)",
        ...(ring ? ({ "--ring-color": color ?? "var(--color-accent)" } as React.CSSProperties) : {}),
        ...style,
      }}
      title={name}
      {...props}
    >
      {initialsFor(name)}
    </span>
  );
}

interface AvatarStackProps {
  people: { id: string; name: string; color?: string }[];
  max?: number;
  size?: AvatarSize;
}

export function AvatarStack({ people, max = 4, size = "sm" }: AvatarStackProps) {
  const visible = people.slice(0, max);
  const overflow = people.length - visible.length;
  return (
    <span className={styles.stack} role="group" aria-label={`${people.length} people`}>
      {visible.map((person) => (
        <Avatar key={person.id} name={person.name} color={person.color} size={size} ring />
      ))}
      {overflow > 0 ? (
        <span className={[styles.avatar, styles[size], styles.overflow].join(" ")}>
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
