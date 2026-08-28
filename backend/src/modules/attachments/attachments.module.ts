import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { DocumentsModule } from '../documents/documents.module';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { Attachment } from './entities/attachment.entity';

@Module({
  imports: [
    AuthModule,
    DocumentsModule, // DocumentsService.get() - existence + workspace scoping
    WorkspacesModule, // WorkspacePermissionsService
    BillingModule, // EntitlementsService.assertCanUploadAttachment (Stage 8)
    // Same pattern as DocumentsModule/CollaborationModule: the guard's own
    // WorkspaceMember repository dependency must resolve in this module's scope.
    TypeOrmModule.forFeature([Attachment, WorkspaceMember]),
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
})
export class AttachmentsModule {}
