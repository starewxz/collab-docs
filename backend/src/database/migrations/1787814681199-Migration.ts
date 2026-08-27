import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1787814681199 implements MigrationInterface {
  name = 'Migration1787814681199';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" character varying(255) NOT NULL, "passwordHash" character varying NOT NULL, "firstName" character varying(100) NOT NULL, "lastName" character varying(100) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email")`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."workspace_role" AS ENUM('OWNER', 'ADMIN', 'EDITOR', 'VIEWER')`,
    );

    await queryRunner.query(
      `CREATE TABLE "workspaces" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(255) NOT NULL, "slug" character varying(255) NOT NULL, "createdById" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_098656ae401f3e1a4586f47fd8e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b8e9fe62e93d60089dfc4f175f" ON "workspaces" ("slug")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_02d4dbfea6311e07d3ed126845" ON "workspaces" ("createdById")`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspaces" ADD CONSTRAINT "FK_workspaces_createdById" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `CREATE TABLE "workspace_members" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspaceId" uuid NOT NULL, "userId" uuid NOT NULL, "role" "public"."workspace_role" NOT NULL, "joinedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_22ab43ac5865cd62769121d2bc4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0dd45cb52108d0664df4e7e33e" ON "workspace_members" ("workspaceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_22176b38813258c2aadaae3244" ON "workspace_members" ("userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_99bcb5fdac446371d41f048b24" ON "workspace_members" ("workspaceId", "userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ADD CONSTRAINT "FK_workspace_members_workspaceId" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ADD CONSTRAINT "FK_workspace_members_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `CREATE TABLE "workspace_invitations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspaceId" uuid NOT NULL, "email" character varying(255) NOT NULL, "role" "public"."workspace_role" NOT NULL, "tokenHash" character varying NOT NULL, "invitedById" uuid NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "acceptedAt" TIMESTAMP WITH TIME ZONE, "rejectedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_525b9069dc828a8ee8fdc62c32c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_65515eaafd8282c3848bddbb00" ON "workspace_invitations" ("workspaceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1ac6b6f3385aaa08effc8bc206" ON "workspace_invitations" ("email")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_92e35608aee47991b38c8921e6" ON "workspace_invitations" ("tokenHash")`,
    );
    // Final concurrency safety net: only one *active* (not yet accepted or
    // rejected) invitation may exist per workspace+email at a time. A
    // partial index lets expired/accepted/rejected invitations coexist
    // with a fresh replacement without violating uniqueness.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_workspace_invitations_active_unique" ON "workspace_invitations" ("workspaceId", "email") WHERE "acceptedAt" IS NULL AND "rejectedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_invitations" ADD CONSTRAINT "FK_workspace_invitations_workspaceId" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_invitations" ADD CONSTRAINT "FK_workspace_invitations_invitedById" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "userId" uuid NOT NULL, "tokenHash" character varying NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "revokedAt" TIMESTAMP WITH TIME ZONE, "replacedByTokenId" uuid, "userAgent" character varying(512), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_610102b60fea1455310ccd299d" ON "refresh_tokens" ("userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c25bc63d248ca90e8dcc1d92d0" ON "refresh_tokens" ("tokenHash")`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_refresh_tokens_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);

    await queryRunner.query(`DROP TABLE "workspace_invitations"`);

    await queryRunner.query(`DROP TABLE "workspace_members"`);

    await queryRunner.query(`DROP TABLE "workspaces"`);

    await queryRunner.query(`DROP TYPE "public"."workspace_role"`);

    await queryRunner.query(`DROP TABLE "users"`);
  }
}
