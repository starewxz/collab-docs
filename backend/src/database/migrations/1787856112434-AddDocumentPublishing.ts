import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentPublishing1787856112434 implements MigrationInterface {
  name = 'AddDocumentPublishing1787856112434';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "isPublished" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "publicSlug" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "publishedAt" TIMESTAMP WITH TIME ZONE`,
    );
    // Plain (non-partial) unique index - Postgres already treats multiple
    // NULLs as distinct, so unpublished documents (publicSlug IS NULL)
    // never collide with each other.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_documents_publicSlug" ON "documents" ("publicSlug")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_documents_publicSlug"`);
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "publishedAt"`,
    );
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "publicSlug"`);
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "isPublished"`,
    );
  }
}
