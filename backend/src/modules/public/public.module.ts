import { Module } from '@nestjs/common';
import { CollaborationModule } from '../collaboration/collaboration.module';
import { DocumentsModule } from '../documents/documents.module';
import { PublicDocumentsController } from './public-documents.controller';
import { PublicDocumentsService } from './public-documents.service';

@Module({
  imports: [
    DocumentsModule, // DocumentsService.findPublishedBySlug
    CollaborationModule, // CollaborationPersistenceService.hydrate
  ],
  controllers: [PublicDocumentsController],
  providers: [PublicDocumentsService],
})
export class PublicModule {}
