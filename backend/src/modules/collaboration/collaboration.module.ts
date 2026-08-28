import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueName } from '../../queue/queue.constants';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { DocumentsModule } from '../documents/documents.module';
import { UsersModule } from '../users/users.module';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { CollaborationPersistenceService } from './collaboration-persistence.service';
import { CollaborationGateway } from './collaboration.gateway';
import { CollaborationService } from './collaboration.service';
import { DocumentVersion } from './entities/document-version.entity';
import { SearchIndexProcessor } from './search-index.processor';
import { VersionsController } from './versions.controller';
import { VersionsService } from './versions.service';

@Module({
  imports: [
    AuthModule, // JwtService for handshake token verification
    DocumentsModule, // DocumentsService.get()/updateSearchContent - existence + workspace scoping
    UsersModule, // display name for presence
    WorkspacesModule, // WorkspacePermissionsService
    BillingModule, // EntitlementsService.assertFeatureEnabled (Stage 8)
    // Same pattern as DocumentsModule: the gateway's own WorkspaceMember
    // repository dependency must be resolvable in this module's scope.
    TypeOrmModule.forFeature([WorkspaceMember, DocumentVersion]),
    // Async search indexing (see SearchIndexProcessor / TT gap 6) - a
    // document edit enqueues here instead of writing contentText inline.
    BullModule.registerQueue({ name: QueueName.SEARCH_INDEX }),
  ],
  controllers: [VersionsController],
  providers: [
    CollaborationGateway,
    CollaborationService,
    CollaborationPersistenceService,
    SearchIndexProcessor,
    VersionsService,
  ],
  exports: [
    CollaborationGateway,
    CollaborationService,
    CollaborationPersistenceService,
  ],
})
export class CollaborationModule {}
