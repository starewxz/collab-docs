export type SubscriptionPlan = "free" | "pro";
export type SubscriptionStatus = "active" | "past_due" | "canceled";

export interface UsageItem {
  used: number;
  /** null means unlimited. */
  limit: number | null;
}

export interface Subscription {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  members: UsageItem;
  documents: UsageItem;
  storageBytes: UsageItem;
  features: Record<string, boolean>;
}
