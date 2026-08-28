import { ApiProperty } from '@nestjs/swagger';
import type { Attachment } from '../entities/attachment.entity';
import type { AttachmentStatus } from '../attachment-status.enum';

export class AttachmentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  documentId: string;

  @ApiProperty()
  filename: string;

  @ApiProperty()
  mimeType: string;

  @ApiProperty()
  size: number;

  @ApiProperty({ enum: ['pending', 'ready'] })
  status: AttachmentStatus;

  @ApiProperty()
  uploadedById: string;

  @ApiProperty()
  createdAt: Date;

  static fromEntity(attachment: Attachment): AttachmentResponseDto {
    const dto = new AttachmentResponseDto();
    dto.id = attachment.id;
    dto.documentId = attachment.documentId;
    dto.filename = attachment.filename;
    dto.mimeType = attachment.mimeType;
    dto.size = attachment.size;
    dto.status = attachment.status;
    dto.uploadedById = attachment.uploadedById;
    dto.createdAt = attachment.createdAt;
    return dto;
  }
}

export class UploadUrlResponseDto {
  @ApiProperty({ type: AttachmentResponseDto })
  attachment: AttachmentResponseDto;

  @ApiProperty({
    description: 'Presigned PUT URL - upload the file directly here',
  })
  uploadUrl: string;

  @ApiProperty()
  expiresInSeconds: number;
}
