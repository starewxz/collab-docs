import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentVersions1787838816430 implements MigrationInterface {
  name = 'AddDocumentVersions1787838816430';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."document_version_kind" AS ENUM('auto', 'manual', 'restore-point')`,
    );
    await queryRunner.query(
      `CREATE TABLE "document_versions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "documentId" uuid NOT NULL, "kind" "public"."document_version_kind" NOT NULL, "state" bytea NOT NULL, "createdById" uuid, "label" character varying(255), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_document_versions" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_document_versions_documentId" ON "document_versions" ("documentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_document_versions_documentId_createdAt" ON "document_versions" ("documentId", "createdAt")`,
    );
    // Exactly one AUTO row per document - the throttled durability buffer is
    // upserted in place, never appended to, so it can never grow unbounded.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_document_versions_auto_unique" ON "document_versions" ("documentId") WHERE "kind" = 'auto'`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_versions" ADD CONSTRAINT "FK_document_versions_documentId" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_versions" ADD CONSTRAINT "FK_document_versions_createdById" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "document_versions"`);
    await queryRunner.query(`DROP TYPE "public"."document_version_kind"`);
  }
}
