import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { CommentMention } from './entities/comment-mention.entity';
import { Comment } from './entities/comment.entity';

@Module({
  imports: [
    AuthModule,
    DocumentsModule, // DocumentsService.get() - existence + workspace scoping + archived check
    UsersModule, // author display names
    NotificationsModule, // enqueue mention/reply/resolve notifications
    WorkspacesModule, // WorkspacePermissionsService
    // Same pattern as DocumentsModule/CollaborationModule/AttachmentsModule:
    // the guard's own WorkspaceMember repository dependency must resolve in
    // this module's scope; also used directly for mention validation.
    TypeOrmModule.forFeature([Comment, CommentMention, WorkspaceMember]),
  ],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
