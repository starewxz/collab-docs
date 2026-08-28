"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, FormField, Input } from "@/components/ui";
import { isApiError } from "@/lib/api-error";
import { useAuth } from "./AuthProvider";
import styles from "./AuthForm.module.css";
import { isValidEmail } from "./validation";

export function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/workspace";
  const sessionExpired = searchParams.get("reason") === "session-expired";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!isValidEmail(email) || password.length === 0) {
      setError("Enter a valid email and your password.");
      return;
    }

    setSubmitting(true);
    try {
      await login({ email, password });
      router.push(next);
    } catch (err) {
      setError(isApiError(err) ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <Link href="/" className={styles.brand} aria-label="Collab Docs home">
        <span className={styles.brandMark} aria-hidden="true">C</span>
        <span>Collab Docs</span>
      </Link>
      <Card className={styles.card}>
        <h1 className={styles.title}>Log in</h1>
        {sessionExpired ? (
          <p className={styles.hint} role="status">
            Your session expired — log in again to continue.
          </p>
        ) : null}
        <form onSubmit={handleSubmit} noValidate>
          <FormField label="Email" htmlFor="email" className={styles.field}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={Boolean(error)}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <FormField label="Password" htmlFor="password" className={styles.field}>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(error)}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" className={styles.submit} disabled={submitting}>
            {submitting ? "Logging in…" : "Log in"}
          </Button>
        </form>
        <p className={styles.footer}>
          Don&apos;t have an account? <Link href="/register">Create one</Link>
        </p>
      </Card>
    </div>
  );
}
