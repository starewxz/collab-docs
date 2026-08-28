import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { SubscriptionPlan } from '../subscription-plan.enum';
import type {
  CheckoutSession,
  PaymentProvider,
} from './payment-provider.interface';

/**
 * Dev/mock provider - no real payment processing happens. There is no
 * external service to redirect to, so `checkoutUrl` is an informational
 * placeholder, not a real hosted page. The frontend's "Upgrade" flow calls
 * `BillingService.mockConfirmPayment` (a dev-only stand-in for a real
 * provider calling our webhook) rather than following `checkoutUrl`
 * anywhere. See ADR-019 for why this boundary exists.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  createCheckoutSession(
    workspaceId: string,
    plan: SubscriptionPlan,
  ): Promise<CheckoutSession> {
    const sessionId = randomUUID();
    return Promise.resolve({
      sessionId,
      checkoutUrl: `mock://checkout/${workspaceId}/${plan}/${sessionId}`,
    });
  }
}
