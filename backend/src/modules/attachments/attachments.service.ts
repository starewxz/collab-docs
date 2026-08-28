import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { MetricsService } from '../../common/metrics/metrics.service';
import { MinioService } from '../../storage/minio.service';
import { DocumentsService } from '../documents/documents.service';
import { AttachmentStatus } from './attachment-status.enum';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import {
  AttachmentResponseDto,
  UploadUrlResponseDto,
} from './dto/attachment-response.dto';
import { Attachment } from './entities/attachment.entity';

/** 20MB - a reasonable bound for document attachments at this project's scale. */
const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;

const UPLOAD_URL_EXPIRY_SECONDS = 300;

/** Deliberately conservative allowlist - common images/documents only. */
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150);
}

/**
 * Direct-to-storage upload flow, reusing the project's existing presigned-
 * URL convention (MinioService) rather than proxying file bytes through
 * this server. Validation happens twice: declared size/MIME are checked
 * before issuing the upload URL (cheap, rejects obviously-bad requests
 * early), and the *actual* uploaded size is re-checked via `statObject` on
 * confirm (the only value that can't be lied about by the client) - never
 * store binary content in Postgres, only this metadata row.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    @InjectRepository(Attachment)
    private readonly attachments: Repository<Attachment>,
    private readonly documentsService: DocumentsService,
    private readonly minio: MinioService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
  ) {
    this.logger.setContext(AttachmentsService.name);
  }

  async createUploadUrl(
    workspaceId: string,
    documentId: string,
    uploadedById: string,
    dto: CreateAttachmentDto,
  ): Promise<UploadUrlResponseDto> {
    await this.documentsService.get(workspaceId, documentId);

    if (dto.size > MAX_ATTACHMENT_SIZE_BYTES) {
      this.metrics.attachmentUploadsTotal.inc({ result: 'rejected' });
      throw new BadRequestException(
        `File exceeds the maximum size of ${MAX_ATTACHMENT_SIZE_BYTES} bytes`,
      );
    }
    if (!ALLOWED_MIME_TYPES.has(dto.mimeType)) {
      this.metrics.attachmentUploadsTotal.inc({ result: 'rejected' });
      throw new BadRequestException(
        `File type "${dto.mimeType}" is not allowed`,
      );
    }

    const objectKey = `attachments/${documentId}/${randomUUID()}-${sanitizeFilename(dto.filename)}`;
    const attachment = await this.attachments.save(
      this.attachments.create({
        documentId,
        objectKey,
        filename: dto.filename,
        mimeType: dto.mimeType,
        size: dto.size,
        status: AttachmentStatus.PENDING,
        uploadedById,
      }),
    );

    const uploadUrl = await this.minio.getPresignedUploadUrl(
      objectKey,
      UPLOAD_URL_EXPIRY_SECONDS,
    );
    this.metrics.attachmentUploadsTotal.inc({ result: 'requested' });

    const response = new UploadUrlResponseDto();
    response.attachment = AttachmentResponseDto.fromEntity(attachment);
    response.uploadUrl = uploadUrl;
    response.expiresInSeconds = UPLOAD_URL_EXPIRY_SECONDS;
    return response;
  }

  async confirm(
    workspaceId: string,
    documentId: string,
    attachmentId: string,
  ): Promise<AttachmentResponseDto> {
    await this.documentsService.get(workspaceId, documentId);
    const attachment = await this.getScoped(documentId, attachmentId);

    let actualSize: number;
    try {
      const stat = await this.minio.statObject(attachment.objectKey);
      actualSize = stat.size;
    } catch {
      throw new BadRequestException(
        'No file was found at the upload URL - upload the file before confirming',
      );
    }

    if (actualSize > MAX_ATTACHMENT_SIZE_BYTES) {
      await this.minio
        .removeObject(attachment.objectKey)
        .catch(() => undefined);
      await this.attachments.remove(attachment);
      this.metrics.attachmentUploadsTotal.inc({ result: 'rejected' });
      throw new BadRequestException(
        'Uploaded file exceeds the maximum allowed size',
      );
    }

    attachment.size = actualSize;
    attachment.status = AttachmentStatus.READY;
    await this.attachments.save(attachment);

    this.metrics.attachmentUploadsTotal.inc({ result: 'confirmed' });
    this.logger.info(
      { event: 'attachment_confirmed', documentId, attachmentId },
      'attachment_confirmed',
    );
    return AttachmentResponseDto.fromEntity(attachment);
  }

  async list(
    workspaceId: string,
    documentId: string,
  ): Promise<AttachmentResponseDto[]> {
    await this.documentsService.get(workspaceId, documentId);
    const rows = await this.attachments.find({
      where: { documentId },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => AttachmentResponseDto.fromEntity(row));
  }

  async getDownloadUrl(
    workspaceId: string,
    documentId: string,
    attachmentId: string,
  ): Promise<{ url: string }> {
    await this.documentsService.get(workspaceId, documentId);
    const attachment = await this.getScoped(documentId, attachmentId);
    if (attachment.status !== AttachmentStatus.READY) {
      throw new BadRequestException(
        'Attachment upload has not been confirmed yet',
      );
    }
    const url = await this.minio.getPresignedDownloadUrl(
      attachment.objectKey,
      UPLOAD_URL_EXPIRY_SECONDS,
    );
    return { url };
  }

  async remove(
    workspaceId: string,
    documentId: string,
    attachmentId: string,
  ): Promise<void> {
    await this.documentsService.get(workspaceId, documentId);
    const attachment = await this.getScoped(documentId, attachmentId);
    await this.minio.removeObject(attachment.objectKey).catch(() => undefined);
    await this.attachments.remove(attachment);
    this.logger.info(
      { event: 'attachment_deleted', documentId, attachmentId },
      'attachment_deleted',
    );
  }

  /** Scoped by (id, documentId) together - the same IDOR-safe pattern used
   * by every other document-scoped lookup in this project. */
  private async getScoped(
    documentId: string,
    attachmentId: string,
  ): Promise<Attachment> {
    const attachment = await this.attachments.findOne({
      where: { id: attachmentId, documentId },
    });
    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }
    return attachment;
  }
}
