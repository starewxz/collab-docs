import { SubscriptionPlan } from './subscription-plan.enum';

/** `null` means unlimited. Centralized here so no service/controller
 * hardcodes a numeric limit itself - see EntitlementsService. */
export interface PlanLimits {
  maxMembers: number | null;
  maxDocuments: number | null;
  maxStorageBytes: number | null;
  /** Named boolean feature gates, e.g. manual version snapshots. */
  features: Record<string, boolean>;
}

export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  [SubscriptionPlan.FREE]: {
    maxMembers: 5,
    maxDocuments: 50,
    maxStorageBytes: 100 * 1024 * 1024, // 100MB
    features: {
      manualVersionSnapshots: false,
    },
  },
  [SubscriptionPlan.PRO]: {
    maxMembers: null,
    maxDocuments: null,
    maxStorageBytes: 10 * 1024 * 1024 * 1024, // 10GB
    features: {
      manualVersionSnapshots: true,
    },
  },
};
