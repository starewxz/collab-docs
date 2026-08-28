import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { MetricsService } from '../../common/metrics/metrics.service';
import { RevalidationService } from '../../common/revalidation/revalidation.service';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { EntitlementsService } from '../billing/entitlements.service';
import { slugify, slugSuffix } from '../workspaces/slug.util';
import { CreateDocumentDto } from './dto/create-document.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import { DocumentSearchResultDto } from './dto/document-search-result.dto';
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
/** Bounds the tsvector/index size and the flush-time decode cost - far
 * more than enough for meaningful search matching at this project's scale. */
const MAX_CONTENT_TEXT_LENGTH = 20_000;

/** Safety-net TTL for the workspace document-tree cache - explicit
 * invalidation (see `invalidateTree`) is the primary mechanism, this just
 * bounds staleness if an invalidation call is ever missed. */
const TREE_CACHE_TTL_SECONDS = 60;

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
    private readonly entitlements: EntitlementsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.logger.setContext(DocumentsService.name);
  }

  /** Locks the workspace row before checking+creating so two concurrent
   * create requests for the same workspace, right at the plan's document
   * limit, can't both slip through - the second waits for the first
   * transaction to commit, then sees the up-to-date count. See ADR-019. */
  async create(
    workspaceId: string,
    createdById: string,
    dto: CreateDocumentDto,
  ): Promise<DocumentResponseDto> {
    const result = await this.dataSource.transaction(async (manager) => {
      await this.entitlements.lockWorkspace(manager, workspaceId);
      await this.entitlements.assertCanCreateDocument(manager, workspaceId);

      const repo = manager.getRepository(Document);
      const parentId = dto.parentId ?? null;

      if (parentId) {
        const parent = await this.getScopedWithManager(
          repo,
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
        repo,
        workspaceId,
        parentId,
      );

      const document = await repo.save(
        repo.create({
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
    });
    await this.invalidateTree(workspaceId);
    return result;
  }

  /**
   * The workspace document tree (TT gap 7: Redis read caching). Always
   * caches the full (including-archived) set under one key per workspace
   * - the `includeArchived=false` view most callers actually want is just
   * an in-memory filter of that, so both call shapes share one cache
   * entry/invalidation path instead of two.
   *
   * Deliberately caches structure only, before any per-user permission
   * filtering (`DocumentPermissionsService.filterVisible`, applied by the
   * controller on every request regardless of cache hit/miss) - so a
   * cached response can never leak a document a given caller shouldn't
   * see. See `08-decisions.md` for why permission filtering must never be
   * baked into a shared cache entry.
   */
  async list(
    workspaceId: string,
    includeArchived: boolean,
  ): Promise<DocumentResponseDto[]> {
    const all = await this.getCachedTree(workspaceId);
    return includeArchived ? all : all.filter((d) => !d.archivedAt);
  }

  private treeCacheKey(workspaceId: string): string {
    return `doc-tree:${workspaceId}`;
  }

  private async getCachedTree(
    workspaceId: string,
  ): Promise<DocumentResponseDto[]> {
    try {
      const cached = await this.redis.get(this.treeCacheKey(workspaceId));
      if (cached) {
        this.metrics.documentTreeCacheTotal.inc({ result: 'hit' });
        return JSON.parse(cached) as DocumentResponseDto[];
      }
    } catch (err) {
      // Redis being unavailable degrades to "always query Postgres", never
      // a broken tree - the same fail-open posture as the rest of this
      // service's non-critical side effects (revalidation, search index).
      this.logger.warn(
        {
          event: 'document_tree_cache_read_failed',
          workspaceId,
          error: (err as Error).message,
        },
        'document_tree_cache_read_failed',
      );
    }

    this.metrics.documentTreeCacheTotal.inc({ result: 'miss' });
    const documents = await this.documents.find({
      where: { workspaceId },
      order: { position: 'ASC' },
    });
    const dtos = documents.map((d) => DocumentResponseDto.fromEntity(d));

    try {
      await this.redis.set(
        this.treeCacheKey(workspaceId),
        JSON.stringify(dtos),
        'EX',
        TREE_CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        {
          event: 'document_tree_cache_write_failed',
          workspaceId,
          error: (err as Error).message,
        },
        'document_tree_cache_write_failed',
      );
    }

    return dtos;
  }

  /** Called after every mutation that changes what the tree looks like
   * (create/rename/move/archive/restore/publish/restrict - see each
   * method below) or that could change which documents are `restricted`.
   * Best-effort: a failure here just means the next read is a full-TTL
   * stale window at worst, never a broken response. */
  private async invalidateTree(workspaceId: string): Promise<void> {
    try {
      await this.redis.del(this.treeCacheKey(workspaceId));
    } catch (err) {
      this.logger.warn(
        {
          event: 'document_tree_cache_invalidate_failed',
          workspaceId,
          error: (err as Error).message,
        },
        'document_tree_cache_invalidate_failed',
      );
    }
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

  /**
   * Workspace-scoped full-text search over title + persisted content
   * (`searchVector`, a GENERATED STORED tsvector column - see the
   * migration and the Document entity). Archived documents are excluded,
   * matching `list()`'s default policy - a search result the caller can't
   * otherwise see in the sidebar would be a confusing inconsistency.
   * `websearch_to_tsquery` accepts natural query syntax (quotes, AND/OR,
   * `-exclude`) safely via parameter binding - never raw string
   * interpolation of `query` into SQL.
   */
  async search(
    workspaceId: string,
    query: string,
    limit: number,
    offset: number,
  ): Promise<DocumentSearchResultDto[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    // Fully explicit raw select (getRawMany, not getRawAndEntities) -
    // TypeORM's mixed entity+raw hydration prefixes implicit entity
    // columns unpredictably (e.g. "d_id"), which is fragile to rely on
    // when several of the fields returned aren't real entity properties
    // (snippet/rank) to begin with. Naming every column explicitly avoids
    // that ambiguity entirely.
    const rows = await this.documents
      .createQueryBuilder('d')
      .select('d.id', 'id')
      .addSelect('d.title', 'title')
      .addSelect('d."parentId"', 'parentId')
      .addSelect('d."updatedAt"', 'updatedAt')
      .addSelect(
        `ts_headline('english', coalesce(d."contentText", d.title), websearch_to_tsquery('english', :query), 'MaxFragments=1, MaxWords=25, MinWords=10')`,
        'snippet',
      )
      .addSelect(
        `ts_rank(d."searchVector", websearch_to_tsquery('english', :query))`,
        'rank',
      )
      .where('d.workspaceId = :workspaceId', { workspaceId })
      .andWhere('d.archivedAt IS NULL')
      .andWhere(`d."searchVector" @@ websearch_to_tsquery('english', :query)`, {
        query: trimmed,
      })
      .orderBy('rank', 'DESC')
      .limit(limit)
      .offset(offset)
      .getRawMany<{
        id: string;
        title: string;
        parentId: string | null;
        updatedAt: Date;
        snippet: string | null;
      }>();

    return rows.map((r) => {
      const dto = new DocumentSearchResultDto();
      dto.id = r.id;
      dto.title = r.title;
      dto.snippet = r.snippet;
      dto.parentId = r.parentId;
      dto.updatedAt = r.updatedAt;
      return dto;
    });
  }

  /** Called by CollaborationPersistenceService.flush with plain text
   * decoded from the durable Yjs buffer it just wrote - never from a live
   * in-memory Y.Doc read directly, and never on every keystroke (the same
   * trailing-throttle that governs the durability buffer governs this).
   * Not scoped by workspaceId: this is an internal system call keyed by
   * documentId alone, not a user-facing endpoint. */
  async updateSearchContent(
    documentId: string,
    contentText: string,
  ): Promise<void> {
    await this.documents.update(
      { id: documentId },
      { contentText: contentText.slice(0, MAX_CONTENT_TEXT_LENGTH) },
    );
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
    await this.invalidateTree(workspaceId);

    return DocumentResponseDto.fromEntity(document);
  }

  async move(
    workspaceId: string,
    documentId: string,
    dto: MoveDocumentDto,
  ): Promise<DocumentResponseDto> {
    const result = await this.dataSource.transaction(async (manager) => {
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
    await this.invalidateTree(workspaceId);
    return result;
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

    await this.invalidateTree(workspaceId);
    for (const slug of unpublishedSlugs) {
      await this.revalidation.revalidateSlug(slug);
    }
  }

  async restore(
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentResponseDto> {
    const result = await this.dataSource.transaction(async (manager) => {
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
    await this.invalidateTree(workspaceId);
    return result;
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
        document.publicAccessMode = dto.mode ?? 'view';
        document.publicExpiresAt = dto.expiresAt
          ? new Date(dto.expiresAt)
          : null;
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
        await this.invalidateTree(workspaceId);

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
    document.publicAccessMode = 'view';
    document.publicExpiresAt = null;
    await this.documents.save(document);

    this.metrics.documentsUnpublishedTotal.inc();
    this.logger.info(
      { event: 'document_unpublished', workspaceId, documentId },
      'document_unpublished',
    );

    if (slug) {
      await this.revalidation.revalidateSlug(slug);
    }
    await this.invalidateTree(workspaceId);

    return DocumentResponseDto.fromEntity(document);
  }

  /** Toggles document-level restriction (see `Document.restricted` /
   * `DocumentPermissionsService`) - a plain field flip, same shape as
   * publish/unpublish. Authorization (OWNER/ADMIN only) is enforced by the
   * controller via `assertCanManageDocumentAccess`, not here. */
  async setRestricted(
    workspaceId: string,
    documentId: string,
    restricted: boolean,
  ): Promise<DocumentResponseDto> {
    const document = await this.getScopedWithManager(
      this.documents,
      workspaceId,
      documentId,
    );
    document.restricted = restricted;
    await this.documents.save(document);

    this.logger.info(
      {
        event: 'document_restriction_changed',
        workspaceId,
        documentId,
        restricted,
      },
      'document_restriction_changed',
    );
    await this.invalidateTree(workspaceId);

    return DocumentResponseDto.fromEntity(document);
  }

  /** Unauthenticated read path (PublicDocumentsService) - deliberately not
   * scoped by workspaceId, since a public visitor never supplies one. The
   * `archivedAt: IsNull()` guard is defense-in-depth on top of the
   * archive-always-unpublishes invariant enforced in `archive()` above.
   * An expired link (`publicExpiresAt` in the past) is treated identically
   * to a nonexistent/unpublished one - callers get `null`, never a
   * distinguishing signal that would leak whether a slug ever existed. */
  async findPublishedBySlug(slug: string): Promise<Document | null> {
    const document = await this.documents.findOne({
      where: { publicSlug: slug, isPublished: true, archivedAt: IsNull() },
    });
    if (!document) return null;
    if (
      document.publicExpiresAt &&
      document.publicExpiresAt.getTime() < Date.now()
    ) {
      return null;
    }
    return document;
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
