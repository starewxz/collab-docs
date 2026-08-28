"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, FormField, Input } from "@/components/ui";
import { isApiError } from "@/lib/api-error";
import { useAuth } from "./AuthProvider";
import styles from "./AuthForm.module.css";
import { isValidEmail, isValidPassword, MIN_PASSWORD_LENGTH } from "./validation";

export function RegisterForm() {
  const { register } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/workspace";
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError("First and last name are required.");
      return;
    }
    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!isValidPassword(password)) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setSubmitting(true);
    try {
      await register({ email, password, firstName, lastName });
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
        <h1 className={styles.title}>Create your account</h1>
        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.row}>
            <FormField label="First name" htmlFor="firstName" className={styles.field}>
              <Input
                id="firstName"
                autoComplete="given-name"
                aria-invalid={Boolean(error)}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </FormField>
            <FormField label="Last name" htmlFor="lastName" className={styles.field}>
              <Input
                id="lastName"
                autoComplete="family-name"
                aria-invalid={Boolean(error)}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </FormField>
          </div>
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
          <FormField
            label="Password"
            htmlFor="password"
            className={styles.field}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters`}
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
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
            {submitting ? "Creating account…" : "Create account"}
          </Button>
        </form>
        <p className={styles.footer}>
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </Card>
    </div>
  );
}
