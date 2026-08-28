"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Spinner, useToast } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { canManageBilling } from "@/features/workspaces/permissions";
import type { WorkspaceRole } from "@/features/workspaces/types";
import { isApiError } from "@/lib/api-error";
import { downgradeToFree, getSubscription, mockPay } from "./api";
import styles from "./BillingSection.module.css";
import type { Subscription, UsageItem } from "./types";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function UsageRow({
  label,
  usage,
  formatUsed,
}: {
  label: string;
  usage: UsageItem;
  formatUsed?: (n: number) => string;
}) {
  const format = formatUsed ?? ((n: number) => String(n));
  const pct =
    usage.limit === null
      ? 0
      : Math.min(100, Math.round((usage.used / Math.max(usage.limit, 1)) * 100));
  const nearLimit = usage.limit !== null && pct >= 90;
  return (
    <div className={styles.usageRow}>
      <div className={styles.usageLabel}>
        <span>{label}</span>
        <span className={styles.usageValue}>
          {format(usage.used)} / {usage.limit === null ? "Unlimited" : format(usage.limit)}
        </span>
      </div>
      {usage.limit !== null ? (
        <div className={styles.usageBar}>
          <div
            className={`${styles.usageBarFill} ${nearLimit ? styles.usageBarFillWarning : ""}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function BillingSection({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: WorkspaceRole;
}) {
  const { apiFetch } = useAuth();
  const { showToast } = useToast();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSubscription(apiFetch, workspaceId)
      .then((sub) => {
        if (cancelled) return;
        setSubscription(sub);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(isApiError(err) ? err.message : "Failed to load billing.");
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch, workspaceId]);

  async function handleUpgrade() {
    setActionError(null);
    setPending(true);
    try {
      const sub = await mockPay(apiFetch, workspaceId);
      setSubscription(sub);
      showToast("Upgraded to PRO");
    } catch (err) {
      setActionError(isApiError(err) ? err.message : "Failed to upgrade.");
    } finally {
      setPending(false);
    }
  }

  async function handleDowngrade() {
    setActionError(null);
    setPending(true);
    try {
      const sub = await downgradeToFree(apiFetch, workspaceId);
      setSubscription(sub);
      showToast("Downgraded to FREE");
    } catch (err) {
      setActionError(isApiError(err) ? err.message : "Failed to downgrade.");
    } finally {
      setPending(false);
    }
  }

  if (error) {
    return (
      <p className={styles.error} role="alert">
        {error}
      </p>
    );
  }

  if (!subscription) {
    return <Spinner label="Loading billing" />;
  }

  const canManage = canManageBilling(role);

  return (
    <Card className={styles.card}>
      <div className={styles.planRow}>
        <Badge variant="accent">{subscription.plan.toUpperCase()}</Badge>
        <span className={styles.statusText}>{subscription.status}</span>
        {subscription.currentPeriodEnd ? (
          <span className={styles.periodText}>
            Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
          </span>
        ) : null}
      </div>

      <div className={styles.usageList}>
        <UsageRow label="Members" usage={subscription.members} />
        <UsageRow label="Documents" usage={subscription.documents} />
        <UsageRow
          label="Storage"
          usage={subscription.storageBytes}
          formatUsed={formatBytes}
        />
      </div>

      {actionError ? (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      ) : null}

      {canManage ? (
        <div className={styles.actions}>
          {subscription.plan === "free" ? (
            <Button size="sm" onClick={handleUpgrade} disabled={pending}>
              {pending ? "Upgrading…" : "Upgrade to PRO"}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={handleDowngrade} disabled={pending}>
              {pending ? "Downgrading…" : "Downgrade to FREE"}
            </Button>
          )}
        </div>
      ) : null}
    </Card>
  );
}
