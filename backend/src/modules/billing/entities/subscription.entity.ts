import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SubscriptionPlan } from '../subscription-plan.enum';
import { SubscriptionStatus } from '../subscription-status.enum';

/**
 * Exactly one row per workspace (unique `workspaceId`), created alongside
 * the workspace itself (see WorkspacesService.createWorkspace) - a
 * workspace with no subscription row should never exist. Billing belongs
 * to the workspace, not individual documents/users.
 */
@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  workspaceId: string;

  @Column({
    type: 'enum',
    enum: SubscriptionPlan,
    enumName: 'subscription_plan',
    default: SubscriptionPlan.FREE,
  })
  plan: SubscriptionPlan;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    enumName: 'subscription_status',
    default: SubscriptionStatus.ACTIVE,
  })
  status: SubscriptionStatus;

  /** Null for FREE (never expires). Set to ~30 days out on a mock/real
   * checkout confirmation for PRO. */
  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodEnd: Date | null;

  /** Which PaymentProvider issued this subscription - 'mock' today,
   * 'stripe' if a real provider is ever wired in (see ADR). */
  @Column({ type: 'varchar', length: 32, default: 'mock' })
  provider: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerCustomerId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerSubscriptionId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
