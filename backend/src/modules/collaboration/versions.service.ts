import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { In, Repository } from 'typeorm';
import * as Y from 'yjs';
import { MetricsService } from '../../common/metrics/metrics.service';
import { DocumentsService } from '../documents/documents.service';
import { UsersService } from '../users/users.service';
import { CollaborationGateway } from './collaboration.gateway';
import { CollaborationPersistenceService } from './collaboration-persistence.service';
import { CollaborationService } from './collaboration.service';
import { DocumentVersionKind } from './document-version-kind.enum';
import {
  RestoreResponseDto,
  VersionDetailResponseDto,
  VersionResponseDto,
} from './dto/version-response.dto';
import { DocumentVersion } from './entities/document-version.entity';
import { decodeState, encodeBlocksSnapshot } from './yjs-document.util';

/** User-facing version history: list/inspect/create/restore. Separate from
 * the AUTO-kind durability buffer in CollaborationPersistenceService, which
 * this reuses (never overwrites) as the fallback source of "current state"
 * when no session is actively open. */
@Injectable()
export class VersionsService {
  constructor(
    @InjectRepository(DocumentVersion)
    private readonly versions: Repository<DocumentVersion>,
    private readonly documentsService: DocumentsService,
    private readonly usersService: UsersService,
    private readonly collaboration: CollaborationService,
    private readonly persistence: CollaborationPersistenceService,
    private readonly gateway: CollaborationGateway,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VersionsService.name);
  }

  async list(
    workspaceId: string,
    documentId: string,
  ): Promise<VersionResponseDto[]> {
    await this.documentsService.get(workspaceId, documentId);

    const rows = await this.versions.find({
      where: {
        documentId,
        kind: In([
          DocumentVersionKind.MANUAL,
          DocumentVersionKind.RESTORE_POINT,
        ]),
      },
      order: { createdAt: 'DESC' },
    });

    const names = await this.resolveAuthorNames(rows);
    return rows.map((row) =>
      VersionResponseDto.fromEntity(
        row,
        row.createdById ? (names.get(row.createdById) ?? null) : null,
      ),
    );
  }

  async inspect(
    workspaceId: string,
    documentId: string,
    versionId: string,
  ): Promise<VersionDetailResponseDto> {
    await this.documentsService.get(workspaceId, documentId);
    const version = await this.getScopedVersion(documentId, versionId);

    const doc = decodeState(new Uint8Array(version.state));
    const blocks = encodeBlocksSnapshot(doc);
    const authorName = version.createdById
      ? await this.resolveAuthorName(version.createdById)
      : null;

    return VersionDetailResponseDto.fromDetail(version, authorName, blocks);
  }

  async create(
    workspaceId: string,
    documentId: string,
    userId: string,
    label: string | undefined,
  ): Promise<VersionResponseDto> {
    const document = await this.documentsService.get(workspaceId, documentId);
    if (document.archivedAt) {
      throw new BadRequestException('Cannot snapshot an archived document');
    }

    const state = await this.getCurrentState(documentId);
    const version = await this.versions.save(
      this.versions.create({
        documentId,
        kind: DocumentVersionKind.MANUAL,
        state: Buffer.from(state),
        createdById: userId,
        label: label ?? null,
      }),
    );

    this.metrics.collabVersionsCreatedTotal.inc({
      kind: DocumentVersionKind.MANUAL,
    });
    this.logger.info(
      {
        event: 'document_version_created',
        documentId,
        versionId: version.id,
        kind: 'manual',
      },
      'document_version_created',
    );

    return VersionResponseDto.fromEntity(
      version,
      await this.resolveAuthorName(userId),
    );
  }

  async restore(
    workspaceId: string,
    documentId: string,
    versionId: string,
    userId: string,
  ): Promise<RestoreResponseDto> {
    const document = await this.documentsService.get(workspaceId, documentId);
    if (document.archivedAt) {
      throw new BadRequestException(
        'Restore an archived document before restoring a version',
      );
    }
    const target = await this.getScopedVersion(documentId, versionId);

    // Current state is preserved as history BEFORE it's overwritten - a
    // restore must never silently destroy what was there.
    const currentState = await this.getCurrentState(documentId);
    const restorePoint = await this.versions.save(
      this.versions.create({
        documentId,
        kind: DocumentVersionKind.RESTORE_POINT,
        state: Buffer.from(currentState),
        createdById: userId,
        label: `Before restoring to version from ${target.createdAt.toISOString()}`,
      }),
    );
    this.metrics.collabVersionsCreatedTotal.inc({
      kind: DocumentVersionKind.RESTORE_POINT,
    });

    try {
      await this.gateway.applyRestoredState(
        documentId,
        new Uint8Array(target.state),
      );
    } catch (err) {
      this.metrics.collabVersionRestoreTotal.inc({ result: 'error' });
      throw err;
    }

    this.metrics.collabVersionRestoreTotal.inc({ result: 'success' });
    this.logger.info(
      { event: 'document_version_restored', documentId, versionId: target.id },
      'document_version_restored',
    );

    const response = new RestoreResponseDto();
    response.restoredFromVersionId = target.id;
    response.historyVersionId = restorePoint.id;
    response.restoredAt = restorePoint.createdAt;
    return response;
  }

  /** Prefers the live in-memory session (always up-to-the-second); falls
   * back to the durable buffer, then an empty doc for a never-opened
   * document. */
  private async getCurrentState(documentId: string): Promise<Uint8Array> {
    const session = this.collaboration.getSession(documentId);
    if (session) {
      return Y.encodeStateAsUpdate(session.ydoc);
    }
    const persisted = await this.persistence.hydrate(documentId);
    return persisted ?? Y.encodeStateAsUpdate(new Y.Doc());
  }

  private async getScopedVersion(
    documentId: string,
    versionId: string,
  ): Promise<DocumentVersion> {
    const version = await this.versions.findOne({
      where: { id: versionId, documentId },
    });
    if (!version) {
      throw new NotFoundException('Version not found');
    }
    return version;
  }

  private async resolveAuthorName(userId: string): Promise<string | null> {
    const user = await this.usersService.findById(userId);
    return user ? `${user.firstName} ${user.lastName}`.trim() : null;
  }

  private async resolveAuthorNames(
    rows: DocumentVersion[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        rows.map((r) => r.createdById).filter((id): id is string => !!id),
      ),
    ];
    const names = new Map<string, string>();
    for (const id of ids) {
      const name = await this.resolveAuthorName(id);
      if (name) names.set(id, name);
    }
    return names;
  }
}
