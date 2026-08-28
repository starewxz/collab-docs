import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { MetricsService } from '../../common/metrics/metrics.service';
import { RevalidationService } from '../../common/revalidation/revalidation.service';
import { slugify, slugSuffix } from '../workspaces/slug.util';
import { CreateDocumentDto } from './dto/create-document.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import type {
  DocumentPlacement,
  MoveDocumentDto,
} from './dto/move-document.dto';
import type { PublishDocumentDto } from './dto/publish-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { Document } from './entities/document.entity';

/** Initial gap between sibling positions - gives room for many midpoint
 * inserts before floating-point precision could ever become a concern. */
const POSITION_STEP = 1000;

const MAX_SLUG_ATTEMPTS = 5;
const UNIQUE_VIOLATION = '23505';

function parentClause(parentId: string | null) {
  return parentId === null ? IsNull() : parentId;
}

@Injectable()
export class DocumentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Document)
    private readonly documents: Repository<Document>,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
    private readonly revalidation: RevalidationService,
  ) {
    this.logger.setContext(DocumentsService.name);
  }

  async create(
    workspaceId: string,
    createdById: string,
    dto: CreateDocumentDto,
  ): Promise<DocumentResponseDto> {
    const parentId = dto.parentId ?? null;

    if (parentId) {
      const parent = await this.getScopedWithManager(
        this.documents,
        workspaceId,
        parentId,
      );
      if (parent.archivedAt) {
        throw new BadRequestException(
          'Cannot create a document under an archived parent',
        );
      }
    }

    const position = await this.nextPositionWithManager(
      this.documents,
      workspaceId,
      parentId,
    );

    const document = await this.documents.save(
      this.documents.create({
        workspaceId,
        parentId,
        title: dto.title,
        position,
        createdById,
      }),
    );

    this.metrics.documentsCreatedTotal.inc();
    this.metrics.documentOperationsTotal.inc({ operation: 'create' });
    this.logger.info(
      { event: 'document_created', workspaceId, documentId: document.id },
      'document_created',
    );

    return DocumentResponseDto.fromEntity(document);
  }

  async list(
    workspaceId: string,
    includeArchived: boolean,
  ): Promise<DocumentResponseDto[]> {
    const documents = await this.documents.find({
      where: includeArchived
        ? { workspaceId }
        : { workspaceId, archivedAt: IsNull() },
      order: { position: 'ASC' },
    });
    return documents.map((d) => DocumentResponseDto.fromEntity(d));
  }

  async get(
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentResponseDto> {
    const document = await this.getScopedWithManager(
      this.documents,
      workspaceId,
      documentId,
    );
    return DocumentResponseDto.fromEntity(document);
  }

  async update(
    workspaceId: string,
    documentId: string,
    dto: UpdateDocumentDto,
  ): Promise<DocumentResponseDto> {
    const document = await this.getScopedWithManager(
      this.documents,
      workspaceId,
      documentId,
    );
    document.title = dto.title;
    await this.documents.save(document);

    this.metrics.documentOperationsTotal.inc({ operation: 'rename' });
    this.logger.info(
      { event: 'document_renamed', workspaceId, documentId },
      'document_renamed',
    );

    return DocumentResponseDto.fromEntity(document);
  }

  async move(
    workspaceId: string,
    documentId: string,
    dto: MoveDocumentDto,
  ): Promise<DocumentResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Document);
      const document = await this.getScopedWithManager(
        repo,
        workspaceId,
        documentId,
      );

      if (document.archivedAt) {
        throw new BadRequestException(
          'Restore an archived document before moving it',
        );
      }

      const newParentId = dto.parentId;
      if (newParentId !== null) {
        if (newParentId === document.id) {
          throw new BadRequestException('A document cannot be its own parent');
        }
        const newParent = await this.getScopedWithManager(
          repo,
          workspaceId,
          newParentId,
        );
        if (newParent.archivedAt) {
          throw new BadRequestException(
            'Cannot move a document under an archived parent',
          );
        }
        if (await this.isDescendantOf(repo, newParentId, document.id)) {
          throw new BadRequestException(
            'Cannot move a document under one of its own descendants',
          );
        }
      }

      const position = await this.computePosition(
        repo,
        workspaceId,
        newParentId,
        dto.referenceId,
        dto.placement,
      );

      document.parentId = newParentId;
      document.position = position;
      await repo.save(document);

      this.metrics.documentOperationsTotal.inc({ operation: 'move' });
      this.logger.info(
        { event: 'document_moved', workspaceId, documentId },
        'document_moved',
      );

      return DocumentResponseDto.fromEntity(document);
    });
  }

  async archive(workspaceId: string, documentId: string): Promise<void> {
    let unpublishedSlugs: string[] = [];
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Document);
      await this.getScopedWithManager(repo, workspaceId, documentId);
      const subtreeIds = await this.collectSubtreeIds(
        repo,
        workspaceId,
        documentId,
      );

      // An archived document is never publicly visible, even if it was
      // published before - clear publish state for the whole subtree
      // rather than letting archived+published states coexist.
      const publishedInSubtree = await repo.find({
        where: { id: In(subtreeIds), isPublished: true },
      });
      unpublishedSlugs = publishedInSubtree
        .map((d) => d.publicSlug)
        .filter((slug): slug is string => slug !== null);

      await repo.update({ id: In(subtreeIds) }, { archivedAt: new Date() });
      if (publishedInSubtree.length > 0) {
        await repo.update(
          { id: In(publishedInSubtree.map((d) => d.id)) },
          { isPublished: false, publishedAt: null },
        );
        this.metrics.documentsUnpublishedTotal.inc(publishedInSubtree.length);
      }

      this.metrics.documentsArchivedTotal.inc();
      this.metrics.documentOperationsTotal.inc({ operation: 'archive' });
      this.logger.info(
        {
          event: 'document_archived',
          workspaceId,
          documentId,
          subtreeSize: subtreeIds.length,
        },
        'document_archived',
      );
    });

    for (const slug of unpublishedSlugs) {
      await this.revalidation.revalidateSlug(slug);
    }
  }

  async restore(
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Document);
      const document = await this.getScopedWithManager(
        repo,
        workspaceId,
        documentId,
      );
      const subtreeIds = await this.collectSubtreeIds(
        repo,
        workspaceId,
        documentId,
      );

      await repo.update({ id: In(subtreeIds) }, { archivedAt: null });

      // If the parent (or its own chain) is still archived, the restored
      // document would be invisible/orphaned in the active tree - reparent
      // it to root instead of leaving it dangling. Only the top of the
      // restored subtree is reparented; its descendants keep their
      // relative structure.
      const originalParentId = document.parentId;
      let parentId = originalParentId;
      if (parentId) {
        const parent = await repo.findOne({
          where: { id: parentId, workspaceId },
        });
        if (!parent || parent.archivedAt) {
          parentId = null;
        }
      }

      document.archivedAt = null;
      document.parentId = parentId;
      if (parentId !== originalParentId) {
        document.position = await this.nextPositionWithManager(
          repo,
          workspaceId,
          parentId,
        );
      }
      await repo.save(document);

      this.metrics.documentOperationsTotal.inc({ operation: 'restore' });
      this.logger.info(
        {
          event: 'document_restored',
          workspaceId,
          documentId,
          subtreeSize: subtreeIds.length,
        },
        'document_restored',
      );

      return DocumentResponseDto.fromEntity(document);
    });
  }

  /**
   * Publishing model: the public page always reflects the document's
   * *latest* durable state (see ADR-017) - publish/republish only toggle
   * visibility and the slug, they never snapshot content. Calling publish
   * again on an already-published document (no new slug given) is a
   * no-op republish that keeps the same URL; passing a new `slug` changes
   * it (the old slug immediately stops resolving - see
   * `findPublishedBySlug`, which only matches the *current* slug).
   */
  async publish(
    workspaceId: string,
    documentId: string,
    dto: PublishDocumentDto,
  ): Promise<DocumentResponseDto> {
    const document = await this.getScopedWithManager(
      this.documents,
      workspaceId,
      documentId,
    );
    if (document.archivedAt) {
      throw new BadRequestException('Cannot publish an archived document');
    }

    const previousSlug = document.publicSlug;
    const requestedBase = dto.slug ? slugify(dto.slug) : null;
    const base = requestedBase ?? previousSlug ?? slugify(document.title);

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${slugSuffix()}`;

      try {
        document.isPublished = true;
        document.publicSlug = candidate;
        document.publishedAt = new Date();
        await this.documents.save(document);

        this.metrics.documentsPublishedTotal.inc();
        this.logger.info(
          { event: 'document_published', workspaceId, documentId },
          'document_published',
        );

        if (previousSlug && previousSlug !== candidate) {
          await this.revalidation.revalidateSlug(previousSlug);
        }
        await this.revalidation.revalidateSlug(candidate);

        return DocumentResponseDto.fromEntity(document);
      } catch (error) {
        if (
          this.isUniqueSlugViolation(error) &&
          attempt < MAX_SLUG_ATTEMPTS - 1
        ) {
          continue;
        }
        throw error;
      }
    }

    // Unreachable in practice - the loop above always returns or throws.
    throw new Error('Failed to allocate a unique public slug');
  }

  async unpublish(
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentResponseDto> {
    const document = await this.getScopedWithManager(
      this.documents,
      workspaceId,
      documentId,
    );
    if (!document.isPublished) {
      return DocumentResponseDto.fromEntity(document); // idempotent no-op
    }

    const slug = document.publicSlug;
    document.isPublished = false;
    document.publishedAt = null;
    await this.documents.save(document);

    this.metrics.documentsUnpublishedTotal.inc();
    this.logger.info(
      { event: 'document_unpublished', workspaceId, documentId },
      'document_unpublished',
    );

    if (slug) {
      await this.revalidation.revalidateSlug(slug);
    }

    return DocumentResponseDto.fromEntity(document);
  }

  /** Unauthenticated read path (PublicDocumentsService) - deliberately not
   * scoped by workspaceId, since a public visitor never supplies one. The
   * `archivedAt: IsNull()` guard is defense-in-depth on top of the
   * archive-always-unpublishes invariant enforced in `archive()` above. */
  async findPublishedBySlug(slug: string): Promise<Document | null> {
    return this.documents.findOne({
      where: { publicSlug: slug, isPublished: true, archivedAt: IsNull() },
    });
  }

  private isUniqueSlugViolation(error: unknown): boolean {
    return (
      !!error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === UNIQUE_VIOLATION
    );
  }

  // --- internal helpers ---

  private async getScopedWithManager(
    repo: Repository<Document>,
    workspaceId: string,
    documentId: string,
  ): Promise<Document> {
    const document = await repo.findOne({
      where: { id: documentId, workspaceId },
    });
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    return document;
  }

  /** Walks up from candidateId's parent chain; true if ancestorId is found. */
  private async isDescendantOf(
    repo: Repository<Document>,
    candidateId: string,
    ancestorId: string,
  ): Promise<boolean> {
    let currentId: string | null = candidateId;
    const maxDepth = 1000; // defensive bound against corrupted/cyclic data
    for (let i = 0; i < maxDepth && currentId; i++) {
      if (currentId === ancestorId) {
        return true;
      }
      const current: Document | null = await repo.findOne({
        where: { id: currentId },
      });
      currentId = current?.parentId ?? null;
    }
    return false;
  }

  /** Breadth-first collection of a document and all its descendants. */
  private async collectSubtreeIds(
    repo: Repository<Document>,
    workspaceId: string,
    rootId: string,
  ): Promise<string[]> {
    const ids = [rootId];
    let frontier = [rootId];
    while (frontier.length > 0) {
      const children = await repo.find({
        where: { workspaceId, parentId: In(frontier) },
      });
      if (children.length === 0) break;
      frontier = children.map((c) => c.id);
      ids.push(...frontier);
    }
    return ids;
  }

  private async nextPositionWithManager(
    repo: Repository<Document>,
    workspaceId: string,
    parentId: string | null,
  ): Promise<number> {
    const last = await repo.findOne({
      where: { workspaceId, parentId: parentClause(parentId) },
      order: { position: 'DESC' },
    });
    return (last?.position ?? 0) + POSITION_STEP;
  }

  private async computePosition(
    repo: Repository<Document>,
    workspaceId: string,
    parentId: string | null,
    referenceId: string | undefined,
    placement: DocumentPlacement | undefined,
  ): Promise<number> {
    if (!referenceId) {
      return this.nextPositionWithManager(repo, workspaceId, parentId);
    }

    const siblings = await repo.find({
      where: { workspaceId, parentId: parentClause(parentId) },
      order: { position: 'ASC' },
    });
    const index = siblings.findIndex((s) => s.id === referenceId);
    if (index === -1) {
      throw new BadRequestException(
        'Reference sibling not found under the target parent',
      );
    }
    const reference = siblings[index];

    if (placement === 'before') {
      const prev = siblings[index - 1];
      return prev
        ? (prev.position + reference.position) / 2
        : reference.position - POSITION_STEP;
    }

    const next = siblings[index + 1];
    return next
      ? (reference.position + next.position) / 2
      : reference.position + POSITION_STEP;
  }
}
