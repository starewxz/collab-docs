import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentAccessControl1787920200000 implements MigrationInterface {
  name = 'AddDocumentAccessControl1787920200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Document-level ACL override (TT gap 1) ---
    await queryRunner.query(
      `CREATE TYPE "public"."document_collaborators_accesslevel_enum" AS ENUM('VIEWER', 'EDITOR')`,
    );
    await queryRunner.query(
      `CREATE TABLE "document_collaborators" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "documentId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "accessLevel" "public"."document_collaborators_accesslevel_enum" NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_document_collaborators_document_user" UNIQUE ("documentId", "userId"),
        CONSTRAINT "PK_document_collaborators" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_document_collaborators_documentId" ON "document_collaborators" ("documentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_document_collaborators_userId" ON "document_collaborators" ("userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "restricted" boolean NOT NULL DEFAULT false`,
    );

    // --- Public edit-by-link + expiry (TT gap 2) ---
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "publicAccessMode" character varying(10) NOT NULL DEFAULT 'view'`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "publicExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "publicExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "publicAccessMode"`,
    );
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "restricted"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_document_collaborators_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_document_collaborators_documentId"`,
    );
    await queryRunner.query(`DROP TABLE "document_collaborators"`);
    await queryRunner.query(
      `DROP TYPE "public"."document_collaborators_accesslevel_enum"`,
    );
  }
}
