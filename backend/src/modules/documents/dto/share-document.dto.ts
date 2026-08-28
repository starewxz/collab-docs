import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID } from 'class-validator';
import { DocumentAccessLevel } from '../entities/document-collaborator.entity';

export class ShareDocumentDto {
  @ApiProperty({ description: 'Workspace member to grant/restrict access for' })
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: DocumentAccessLevel })
  @IsEnum(DocumentAccessLevel)
  accessLevel: DocumentAccessLevel;
}
