import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Attachment } from '../attachments/entities/attachment.entity';
import { Document } from '../documents/entities/document.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { WorkspaceMembershipGuard } from '../workspaces/guards/workspace-membership.guard';
import { WorkspacePermissionsService } from '../workspaces/workspace-permissions.service';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing-webhook.controller';
import { BillingService } from './billing.service';
import { EntitlementsService } from './entitlements.service';
import { BillingWebhookEvent } from './entities/billing-webhook-event.entity';
import { Subscription } from './entities/subscription.entity';
import { MockPaymentProvider } from './providers/mock-payment-provider.service';
import { PAYMENT_PROVIDER } from './providers/payment-provider.interface';

/**
 * Deliberately does NOT import WorkspacesModule/DocumentsModule/
 * AttachmentsModule, even though it needs their entities and reuses
 * WorkspacePermissionsService/WorkspaceMembershipGuard - those modules
 * need to import *this* module (for EntitlementsService/BillingService),
 * and NestJS modules can't import each other circularly without
 * forwardRef gymnastics. Registering the entities directly via
 * TypeOrmModule.forFeature and re-providing the two small, stateless
 * permission classes here (same instances-shape, no cycle) keeps the
 * dependency graph a clean one-way arrow: everything -> BillingModule.
 */
@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Subscription,
      BillingWebhookEvent,
      Workspace,
      WorkspaceMember,
      Document,
      Attachment,
    ]),
  ],
  controllers: [BillingController, BillingWebhookController],
  providers: [
    BillingService,
    EntitlementsService,
    WorkspacePermissionsService,
    WorkspaceMembershipGuard,
    { provide: PAYMENT_PROVIDER, useClass: MockPaymentProvider },
  ],
  exports: [BillingService, EntitlementsService],
})
export class BillingModule {}
