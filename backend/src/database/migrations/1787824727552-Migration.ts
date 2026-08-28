import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1787824727552 implements MigrationInterface {
  name = 'Migration1787824727552';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "documents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspaceId" uuid NOT NULL, "parentId" uuid, "title" character varying(255) NOT NULL, "position" double precision NOT NULL, "createdById" uuid NOT NULL, "archivedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ac51aa5181ee2036f5ca482857c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_documents_workspaceId" ON "documents" ("workspaceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_documents_parentId" ON "documents" ("parentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_documents_archivedAt" ON "documents" ("archivedAt")`,
    );
    // Primary access pattern: "ordered children of a given parent in a
    // given workspace" - covers both the flat workspace listing and
    // per-parent sibling ordering in one index.
    await queryRunner.query(
      `CREATE INDEX "IDX_documents_workspaceId_parentId_position" ON "documents" ("workspaceId", "parentId", "position")`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD CONSTRAINT "FK_documents_workspaceId" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD CONSTRAINT "FK_documents_parentId" FOREIGN KEY ("parentId") REFERENCES "documents"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD CONSTRAINT "FK_documents_createdById" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "documents"`);
  }
}
