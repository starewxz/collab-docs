import { ApiProperty } from '@nestjs/swagger';
import type { Document } from '../entities/document.entity';

export class DocumentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  workspaceId: string;

  @ApiProperty({ nullable: true })
  parentId: string | null;

  @ApiProperty()
  title: string;

  @ApiProperty()
  position: number;

  @ApiProperty()
  createdById: string;

  @ApiProperty({ nullable: true })
  archivedAt: Date | null;

  @ApiProperty()
  isPublished: boolean;

  @ApiProperty({ nullable: true })
  publicSlug: string | null;

  @ApiProperty({ nullable: true })
  publishedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromEntity(document: Document): DocumentResponseDto {
    const dto = new DocumentResponseDto();
    dto.id = document.id;
    dto.workspaceId = document.workspaceId;
    dto.parentId = document.parentId;
    dto.title = document.title;
    dto.position = document.position;
    dto.createdById = document.createdById;
    dto.archivedAt = document.archivedAt;
    dto.isPublished = document.isPublished;
    dto.publicSlug = document.publicSlug;
    dto.publishedAt = document.publishedAt;
    dto.createdAt = document.createdAt;
    dto.updatedAt = document.updatedAt;
    return dto;
  }
}
