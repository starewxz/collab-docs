import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { DocumentPermissionsService } from './document-permissions.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentCollaborator } from './entities/document-collaborator.entity';
import { Document } from './entities/document.entity';

@Module({
  imports: [
    AuthModule,
    WorkspacesModule, // WorkspacePermissionsService + WorkspaceMembershipGuard
    BillingModule, // EntitlementsService.assertCanCreateDocument (Stage 8)
    // WorkspaceMembershipGuard is applied via @UseGuards() in this module's
    // controller, which resolves the guard's own constructor dependencies
    // (the WorkspaceMember repository) locally rather than reusing
    // WorkspacesModule's instance - so it must be registered here too.
    // DocumentPermissionsService needs the same WorkspaceMember repository
    // to validate share targets are actual workspace members.
    TypeOrmModule.forFeature([Document, WorkspaceMember, DocumentCollaborator]),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentPermissionsService],
  exports: [DocumentsService, DocumentPermissionsService],
})
export class DocumentsModule {}
