import { Injectable, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { MetricsService } from '../../common/metrics/metrics.service';
import { CollaborationPersistenceService } from '../collaboration/collaboration-persistence.service';
import {
  decodeState,
  encodeBlocksSnapshot,
} from '../collaboration/yjs-document.util';
import { DocumentsService } from '../documents/documents.service';
import { PublicDocumentResponseDto } from './dto/public-document-response.dto';

/**
 * Unauthenticated read path. Reads only the durable Yjs buffer (the same
 * AUTO row CollaborationPersistenceService maintains) - never an in-memory
 * live session - so a published page is correct even for a document with
 * zero active collaborators, and survives a server restart. See ADR-017.
 */
@Injectable()
export class PublicDocumentsService {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly persistence: CollaborationPersistenceService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
  ) {
    this.logger.setContext(PublicDocumentsService.name);
  }

  async getPublished(slug: string): Promise<PublicDocumentResponseDto> {
    const document = await this.documentsService.findPublishedBySlug(slug);
    if (!document) {
      throw new NotFoundException('This page is not available');
    }

    let blocks: PublicDocumentResponseDto['blocks'] = [];
    try {
      const state = await this.persistence.hydrate(document.id);
      if (state) {
        blocks = encodeBlocksSnapshot(decodeState(state));
      }
    } catch (err) {
      this.metrics.publicRenderFailuresTotal.inc();
      this.logger.warn(
        { event: 'public_render_failed', error: (err as Error).message },
        'public_render_failed',
      );
      throw err;
    }

    const dto = new PublicDocumentResponseDto();
    dto.title = document.title;
    dto.blocks = blocks;
    dto.publishedAt = document.publishedAt!;
    dto.mode = document.publicAccessMode;
    return dto;
  }
}
