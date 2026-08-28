import { SubscriptionPlan } from '../subscription-plan.enum';

export interface CheckoutSession {
  sessionId: string;
  checkoutUrl: string;
}

/**
 * Provider boundary: `BillingService` only ever talks to this interface,
 * never to a concrete payment SDK directly. Swapping the mock
 * implementation for a real Stripe one (Checkout Session creation +
 * signature-verified webhook parsing) touches only the class that
 * implements this interface and the webhook controller's signature check
 * - not `BillingService`, `EntitlementsService`, or any call site.
 */
export interface PaymentProvider {
  createCheckoutSession(
    workspaceId: string,
    plan: SubscriptionPlan,
  ): Promise<CheckoutSession>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
