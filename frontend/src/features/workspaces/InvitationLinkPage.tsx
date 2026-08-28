"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Spinner } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { isApiError, isPlanLimitError } from "@/lib/api-error";
import { acceptInvitation, rejectInvitation } from "./api";
import styles from "./InvitationLinkPage.module.css";

export function InvitationLinkPage({ token }: { token: string }) {
  const { status, apiFetch } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleAccept() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await acceptInvitation(apiFetch, token);
      router.push(`/workspace/${result.workspaceId}`);
    } catch (err) {
      // The member-limit check runs at accept time, not invite-creation
      // time (see backend InvitationsService.performAccept) - the invitee
      // isn't the one who can upgrade, so point them to the owner instead.
      if (isPlanLimitError(err)) {
        setError(`${err.message} Ask the workspace owner to upgrade to PRO.`);
      } else {
        setError(isApiError(err) ? err.message : "Failed to accept invitation.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    setError(null);
    setSubmitting(true);
    try {
      await rejectInvitation(apiFetch, token);
      setMessage("Invitation rejected.");
    } catch (err) {
      setError(isApiError(err) ? err.message : "Failed to reject invitation.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className={styles.wrapper}>
        <Spinner label="Loading" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className={styles.wrapper}>
        <Card className={styles.card}>
          <h1 className={styles.title}>You&apos;ve been invited</h1>
          <p className={styles.message}>Log in or create an account to respond.</p>
          <div className={styles.actions}>
            <Link href={`/login?next=/invitations/${token}`}>
              <Button>Log in</Button>
            </Link>
            <Link href={`/register?next=/invitations/${token}`}>
              <Button variant="secondary">Register</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <Card className={styles.card}>
        <h1 className={styles.title}>You&apos;ve been invited to a workspace</h1>
        {message ? (
          <p className={styles.message}>{message}</p>
        ) : (
          <>
            <p className={styles.message}>Would you like to accept or reject this invitation?</p>
            <div className={styles.actions}>
              <Button onClick={handleAccept} disabled={submitting}>
                Accept
              </Button>
              <Button variant="secondary" onClick={handleReject} disabled={submitting}>
                Reject
              </Button>
            </div>
          </>
        )}
        {error ? <p className={styles.error}>{error}</p> : null}
      </Card>
    </div>
  );
}
