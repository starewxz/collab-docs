import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Foundation migration: enables pgcrypto so future entities can default
 * UUID primary keys to gen_random_uuid() without an app-side dependency.
 */
export class EnableUuidExtension1787748663603 implements MigrationInterface {
  name = 'EnableUuidExtension1787748663603';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP EXTENSION IF EXISTS "pgcrypto"`);
  }
}
