import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommentsNotificationsAttachments1787844286371 implements MigrationInterface {
  name = 'AddCommentsNotificationsAttachments1787844286371';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // attachments
    await queryRunner.query(
      `CREATE TYPE "public"."attachment_status" AS ENUM('pending', 'ready')`,
    );
    await queryRunner.query(
      `CREATE TABLE "attachments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "documentId" uuid NOT NULL, "objectKey" character varying(512) NOT NULL, "filename" character varying(255) NOT NULL, "mimeType" character varying(255) NOT NULL, "size" integer NOT NULL, "status" "public"."attachment_status" NOT NULL DEFAULT 'pending', "uploadedById" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_attachments_objectKey" UNIQUE ("objectKey"), CONSTRAINT "PK_attachments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_attachments_documentId" ON "attachments" ("documentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_attachments_documentId_createdAt" ON "attachments" ("documentId", "createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" ADD CONSTRAINT "FK_attachments_documentId" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" ADD CONSTRAINT "FK_attachments_uploadedById" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE CASCADE`,
    );

    // comments + comment_mentions
    await queryRunner.query(
      `CREATE TABLE "comments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "documentId" uuid NOT NULL, "parentCommentId" uuid, "authorId" uuid NOT NULL, "content" text NOT NULL, "resolvedAt" TIMESTAMP WITH TIME ZONE, "resolvedById" uuid, "editedAt" TIMESTAMP WITH TIME ZONE, "deletedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_comments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_comments_documentId" ON "comments" ("documentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_comments_parentCommentId" ON "comments" ("parentCommentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_comments_deletedAt" ON "comments" ("deletedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_comments_documentId_parentCommentId_createdAt" ON "comments" ("documentId", "parentCommentId", "createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" ADD CONSTRAINT "FK_comments_documentId" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" ADD CONSTRAINT "FK_comments_parentCommentId" FOREIGN KEY ("parentCommentId") REFERENCES "comments"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" ADD CONSTRAINT "FK_comments_authorId" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" ADD CONSTRAINT "FK_comments_resolvedById" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `CREATE TABLE "comment_mentions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "commentId" uuid NOT NULL, "mentionedUserId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_comment_mentions" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_comment_mentions_commentId" ON "comment_mentions" ("commentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_comment_mentions_mentionedUserId" ON "comment_mentions" ("mentionedUserId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_comment_mentions_unique" ON "comment_mentions" ("commentId", "mentionedUserId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "comment_mentions" ADD CONSTRAINT "FK_comment_mentions_commentId" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "comment_mentions" ADD CONSTRAINT "FK_comment_mentions_mentionedUserId" FOREIGN KEY ("mentionedUserId") REFERENCES "users"("id") ON DELETE CASCADE`,
    );

    // notifications
    await queryRunner.query(
      `CREATE TYPE "public"."notification_type" AS ENUM('mention', 'reply', 'thread_resolved', 'thread_reopened')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "userId" uuid NOT NULL, "type" "public"."notification_type" NOT NULL, "documentId" uuid NOT NULL, "commentId" uuid, "actorId" uuid, "dedupeKey" character varying(255) NOT NULL, "readAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_notifications_dedupeKey" UNIQUE ("dedupeKey"), CONSTRAINT "PK_notifications" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_userId" ON "notifications" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_userId_readAt_createdAt" ON "notifications" ("userId", "readAt", "createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_notifications_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_notifications_documentId" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_notifications_commentId" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_notifications_actorId" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TYPE "public"."notification_type"`);
    await queryRunner.query(`DROP TABLE "comment_mentions"`);
    await queryRunner.query(`DROP TABLE "comments"`);
    await queryRunner.query(`DROP TABLE "attachments"`);
    await queryRunner.query(`DROP TYPE "public"."attachment_status"`);
  }
}
