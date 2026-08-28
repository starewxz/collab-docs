import { ApiProperty } from '@nestjs/swagger';
import type { DocumentCollaborator } from '../entities/document-collaborator.entity';
import { DocumentAccessLevel } from '../entities/document-collaborator.entity';

export class DocumentCollaboratorResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({ enum: DocumentAccessLevel })
  accessLevel: DocumentAccessLevel;

  @ApiProperty()
  createdAt: Date;

  static fromEntity(
    collaborator: DocumentCollaborator,
  ): DocumentCollaboratorResponseDto {
    const dto = new DocumentCollaboratorResponseDto();
    dto.id = collaborator.id;
    dto.userId = collaborator.userId;
    dto.accessLevel = collaborator.accessLevel;
    dto.createdAt = collaborator.createdAt;
    return dto;
  }
}
