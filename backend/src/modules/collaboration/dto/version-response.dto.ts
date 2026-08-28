import { ApiProperty } from '@nestjs/swagger';
import type { DocumentVersion } from '../entities/document-version.entity';
import type { PlainBlock } from '../yjs-document.util';

export class VersionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  documentId: string;

  @ApiProperty({ enum: ['manual', 'restore-point'] })
  kind: string;

  @ApiProperty({ nullable: true })
  createdById: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Resolved display name of createdById',
  })
  authorName: string | null;

  @ApiProperty({ nullable: true })
  label: string | null;

  @ApiProperty()
  createdAt: Date;

  static fromEntity(
    version: DocumentVersion,
    authorName: string | null,
  ): VersionResponseDto {
    const dto = new VersionResponseDto();
    dto.id = version.id;
    dto.documentId = version.documentId;
    dto.kind = version.kind;
    dto.createdById = version.createdById;
    dto.authorName = authorName;
    dto.label = version.label;
    dto.createdAt = version.createdAt;
    return dto;
  }
}

export class VersionDetailResponseDto extends VersionResponseDto {
  @ApiProperty({ type: 'array' })
  blocks: PlainBlock[];

  static fromDetail(
    version: DocumentVersion,
    authorName: string | null,
    blocks: PlainBlock[],
  ): VersionDetailResponseDto {
    const dto = new VersionDetailResponseDto();
    Object.assign(dto, VersionResponseDto.fromEntity(version, authorName));
    dto.blocks = blocks;
    return dto;
  }
}

export class RestoreResponseDto {
  @ApiProperty({ description: 'The version id that content was restored from' })
  restoredFromVersionId: string;

  @ApiProperty({
    description:
      'The new history entry capturing the state right before this restore',
  })
  historyVersionId: string;

  @ApiProperty()
  restoredAt: Date;
}
