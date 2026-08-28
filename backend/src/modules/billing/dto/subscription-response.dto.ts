import { ApiProperty } from '@nestjs/swagger';
import type { Subscription } from '../entities/subscription.entity';
import type { SubscriptionPlan } from '../subscription-plan.enum';
import type { SubscriptionStatus } from '../subscription-status.enum';

export class UsageItemDto {
  @ApiProperty()
  used: number;

  @ApiProperty({ nullable: true, description: 'null means unlimited' })
  limit: number | null;
}

export class SubscriptionResponseDto {
  @ApiProperty({ enum: ['free', 'pro'] })
  plan: SubscriptionPlan;

  @ApiProperty({ enum: ['active', 'past_due', 'canceled'] })
  status: SubscriptionStatus;

  @ApiProperty({ nullable: true })
  currentPeriodEnd: Date | null;

  @ApiProperty()
  members: UsageItemDto;

  @ApiProperty()
  documents: UsageItemDto;

  @ApiProperty()
  storageBytes: UsageItemDto;

  @ApiProperty({
    type: Object,
    description: 'Named boolean feature gates for this plan',
  })
  features: Record<string, boolean>;

  static fromEntity(
    subscription: Subscription,
    usage: { members: number; documents: number; storageBytes: number },
    limits: {
      maxMembers: number | null;
      maxDocuments: number | null;
      maxStorageBytes: number | null;
      features: Record<string, boolean>;
    },
  ): SubscriptionResponseDto {
    const dto = new SubscriptionResponseDto();
    dto.plan = subscription.plan;
    dto.status = subscription.status;
    dto.currentPeriodEnd = subscription.currentPeriodEnd;
    dto.members = { used: usage.members, limit: limits.maxMembers };
    dto.documents = { used: usage.documents, limit: limits.maxDocuments };
    dto.storageBytes = {
      used: usage.storageBytes,
      limit: limits.maxStorageBytes,
    };
    dto.features = limits.features;
    return dto;
  }
}
