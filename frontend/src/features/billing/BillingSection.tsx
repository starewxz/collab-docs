"use client";

import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
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
          <div className={styles.usageBarFill} style={{ width: `${pct}%` }} />
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
    } catch (err) {
      setActionError(isApiError(err) ? err.message : "Failed to downgrade.");
    } finally {
      setPending(false);
    }
  }

  if (error) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Billing &amp; plan</h2>
        <p className={styles.error}>{error}</p>
      </section>
    );
  }

  if (!subscription) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Billing &amp; plan</h2>
        <Spinner label="Loading billing" />
      </section>
    );
  }

  const canManage = canManageBilling(role);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Billing &amp; plan</h2>

      <div className={styles.planRow}>
        <span className={styles.planBadge}>{subscription.plan.toUpperCase()}</span>
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

      {actionError ? <p className={styles.error}>{actionError}</p> : null}

      {canManage ? (
        <div className={styles.actions}>
          {subscription.plan === "free" ? (
            <Button onClick={handleUpgrade} disabled={pending}>
              {pending ? "Upgrading…" : "Upgrade to PRO"}
            </Button>
          ) : (
            <Button variant="secondary" onClick={handleDowngrade} disabled={pending}>
              {pending ? "Downgrading…" : "Downgrade to FREE"}
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
