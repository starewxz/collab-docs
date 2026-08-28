import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AppConfigService } from '../../config/app-config.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { BillingService } from './billing.service';
import { WebhookEventDto } from './dto/webhook-event.dto';

/**
 * Real payment-provider webhooks are never authenticated with a user JWT
 * - they're verified by a provider signature instead (Stripe's
 * `Stripe-Signature` header + signing secret). This mock stands in with a
 * shared secret header, kept out of Swagger since it's not a
 * browser-facing endpoint. Never called by the frontend - only by (a
 * simulated) payment provider.
 */
@ApiExcludeController()
@Controller('billing/webhook')
export class BillingWebhookController {
  constructor(
    private readonly billingService: BillingService,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post()
  async handleWebhook(
    @Headers('x-billing-webhook-secret') secret: string | undefined,
    @Body() dto: WebhookEventDto,
  ): Promise<{ received: true }> {
    const expected = this.config.billing.webhookSecret;
    if (!expected || secret !== expected) {
      this.metrics.billingWebhookFailuresTotal.inc();
      throw new UnauthorizedException('Invalid webhook signature');
    }

    await this.billingService.applyEvent(dto);
    return { received: true };
  }
}
