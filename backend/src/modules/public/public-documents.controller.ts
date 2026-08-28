import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PublicDocumentResponseDto } from './dto/public-document-response.dto';
import { PublicDocumentsService } from './public-documents.service';

/** No guards at all, intentionally - this is the one controller in the
 * app that must be reachable with zero authentication. It only ever
 * touches documents where isPublished=true (enforced in
 * DocumentsService.findPublishedBySlug), never anything workspace-scoped. */
@ApiTags('public')
@Controller('public/documents')
export class PublicDocumentsController {
  constructor(
    private readonly publicDocumentsService: PublicDocumentsService,
  ) {}

  @Get(':slug')
  async getBySlug(
    @Param('slug') slug: string,
  ): Promise<PublicDocumentResponseDto> {
    return this.publicDocumentsService.getPublished(slug);
  }
}
