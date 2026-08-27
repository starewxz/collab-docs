import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, In, Repository } from 'typeorm';
import { MetricsService } from '../../common/metrics/metrics.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { WorkspaceResponseDto } from './dto/workspace-response.dto';
import { Workspace } from './entities/workspace.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspaceRole } from './workspace-role.enum';
import { slugify, slugSuffix } from './slug.util';

const MAX_SLUG_ATTEMPTS = 5;
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(WorkspaceMember)
    private readonly members: Repository<WorkspaceMember>,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
  ) {
    this.logger.setContext(WorkspacesService.name);
  }

  async createWorkspace(
    userId: string,
    dto: CreateWorkspaceDto,
  ): Promise<WorkspaceResponseDto> {
    const base = slugify(dto.name);

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${slugSuffix()}`;

      try {
        // Workspace + owner membership must never exist independently, so
        // both writes happen in one transaction.
        const workspace = await this.dataSource.transaction(async (manager) => {
          const created = await manager.save(
            manager.create(Workspace, {
              name: dto.name,
              slug,
              createdById: userId,
            }),
          );
          await manager.save(
            manager.create(WorkspaceMember, {
              workspaceId: created.id,
              userId,
              role: WorkspaceRole.OWNER,
            }),
          );
          return created;
        });

        this.metrics.workspacesCreatedTotal.inc();
        this.logger.info(
          { event: 'workspace_created', workspaceId: workspace.id },
          'workspace_created',
        );

        return WorkspaceResponseDto.fromEntity(workspace, WorkspaceRole.OWNER);
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
    throw new Error('Failed to allocate a unique workspace slug');
  }

  async listForUser(userId: string): Promise<WorkspaceResponseDto[]> {
    const memberships = await this.members.find({ where: { userId } });
    if (memberships.length === 0) {
      return [];
    }

    const workspaces = await this.workspaces.findBy({
      id: In(memberships.map((m) => m.workspaceId)),
    });
    const workspaceById = new Map(workspaces.map((w) => [w.id, w]));

    return memberships
      .map((membership) => {
        const workspace = workspaceById.get(membership.workspaceId);
        return workspace
          ? WorkspaceResponseDto.fromEntity(workspace, membership.role)
          : null;
      })
      .filter((dto): dto is WorkspaceResponseDto => dto !== null);
  }

  async getWorkspace(workspaceId: string): Promise<Workspace> {
    const workspace = await this.workspaces.findOne({
      where: { id: workspaceId },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    return workspace;
  }

  private isUniqueSlugViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === UNIQUE_VIOLATION
    );
  }
}
