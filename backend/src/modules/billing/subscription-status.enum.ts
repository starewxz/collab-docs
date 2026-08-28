/** `active` covers both a real paid period and the FREE plan's permanent
 * "active" state - FREE never expires, so `currentPeriodEnd` is null for
 * it. `past_due`/`canceled` only ever apply to PRO. */
export enum SubscriptionStatus {
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
}
