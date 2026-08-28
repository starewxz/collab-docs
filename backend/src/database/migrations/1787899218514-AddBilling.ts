import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBilling1787899218514 implements MigrationInterface {
  name = 'AddBilling1787899218514';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "billing_webhook_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "eventId" character varying(255) NOT NULL, "workspaceId" uuid NOT NULL, "type" character varying(64) NOT NULL, "processedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_billing_webhook_events" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_billing_webhook_events_eventId" ON "billing_webhook_events" ("eventId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing_webhook_events" ADD CONSTRAINT "FK_billing_webhook_events_workspaceId" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."subscription_plan" AS ENUM('free', 'pro')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'canceled')`,
    );
    await queryRunner.query(
      `CREATE TABLE "subscriptions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspaceId" uuid NOT NULL, "plan" "public"."subscription_plan" NOT NULL DEFAULT 'free', "status" "public"."subscription_status" NOT NULL DEFAULT 'active', "currentPeriodEnd" TIMESTAMP WITH TIME ZONE, "provider" character varying(32) NOT NULL DEFAULT 'mock', "providerCustomerId" character varying(255), "providerSubscriptionId" character varying(255), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_subscriptions" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_subscriptions_workspaceId" ON "subscriptions" ("workspaceId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_subscriptions_workspaceId" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE`,
    );

    // Backfill: every workspace created before this migration gets a
    // default FREE subscription, preserving the "a workspace never exists
    // without a subscription row" invariant for pre-existing data.
    await queryRunner.query(
      `INSERT INTO "subscriptions" ("workspaceId", "plan", "status") SELECT "id", 'free', 'active' FROM "workspaces"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "subscriptions"`);
    await queryRunner.query(`DROP TYPE "public"."subscription_status"`);
    await queryRunner.query(`DROP TYPE "public"."subscription_plan"`);
    await queryRunner.query(`DROP TABLE "billing_webhook_events"`);
  }
}
