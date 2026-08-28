import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { Document } from './entities/document.entity';

@Module({
  imports: [
    AuthModule,
    WorkspacesModule, // WorkspacePermissionsService + WorkspaceMembershipGuard
    // WorkspaceMembershipGuard is applied via @UseGuards() in this module's
    // controller, which resolves the guard's own constructor dependencies
    // (the WorkspaceMember repository) locally rather than reusing
    // WorkspacesModule's instance - so it must be registered here too.
    TypeOrmModule.forFeature([Document, WorkspaceMember]),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
