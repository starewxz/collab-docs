import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";
import styles from "./Input.module.css";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  const classes = [styles.field, className].filter(Boolean).join(" ");
  return <input className={classes} {...props} />;
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...props }: TextareaProps) {
  const classes = [styles.field, styles.textarea, className].filter(Boolean).join(" ");
  return <textarea className={classes} {...props} />;
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...props }: SelectProps) {
  const classes = [styles.field, styles.select, className].filter(Boolean).join(" ");
  return <select className={classes} {...props} />;
}
