import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentSearch1787899718705 implements MigrationInterface {
  name = 'AddDocumentSearch1787899718705';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" ADD "contentText" text`);
    // GENERATED ALWAYS AS ... STORED: Postgres maintains this column
    // automatically whenever "title" or "contentText" change - no trigger,
    // no app-level "keep the vector in sync" code needed. "title" is
    // weighted 'A' (title matches rank higher than body-text matches).
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "searchVector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("contentText", '')), 'B')) STORED`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_documents_searchVector" ON "documents" USING GIN ("searchVector")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_documents_searchVector"`);
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "searchVector"`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "contentText"`,
    );
  }
}
