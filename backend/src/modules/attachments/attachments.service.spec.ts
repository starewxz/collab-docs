import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AttachmentStatus } from './attachment-status.enum';
import { AttachmentsService } from './attachments.service';

function buildService(seed: Record<string, unknown>[] = []) {
  const rows = [...seed];
  let seq = rows.length;

  const repo = {
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      return (
        rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ??
        null
      );
    }),
    save: jest.fn((entity: Record<string, unknown>) => {
      if (!entity.id) {
        entity.id = `att-${++seq}`;
        entity.createdAt = new Date();
        rows.push(entity);
      }
      return Promise.resolve(entity);
    }),
    create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
    remove: jest.fn((entity: Record<string, unknown>) => {
      const idx = rows.findIndex((r) => r.id === entity.id);
      if (idx !== -1) rows.splice(idx, 1);
      return Promise.resolve(entity);
    }),
    find: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v)),
    ),
  };

  const documentsService = {
    get: jest.fn((_workspaceId: string, documentId: string) => ({
      id: documentId,
      archivedAt: null,
    })),
  };
  const minio = {
    getPresignedUploadUrl: jest.fn(() =>
      Promise.resolve('https://minio/upload'),
    ),
    getPresignedDownloadUrl: jest.fn(() =>
      Promise.resolve('https://minio/download'),
    ),
    statObject: jest.fn(() => Promise.resolve({ size: 100 })),
    removeObject: jest.fn(() => Promise.resolve()),
  };
  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() };
  const metrics = { attachmentUploadsTotal: { inc: jest.fn() } };
  const entitlements = { assertCanUploadAttachment: jest.fn() };

  const service = new AttachmentsService(
    repo as never,
    documentsService as never,
    minio as never,
    logger as never,
    metrics as never,
    entitlements as never,
  );

  return {
    service,
    repo,
    rows,
    documentsService,
    minio,
    metrics,
    entitlements,
  };
}

describe('AttachmentsService', () => {
  describe('createUploadUrl', () => {
    it('rejects a declared size over the maximum', async () => {
      const { service } = buildService();
      await expect(
        service.createUploadUrl('ws-1', 'doc-1', 'user-1', {
          filename: 'huge.png',
          mimeType: 'image/png',
          size: 999_999_999,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a disallowed MIME type', async () => {
      const { service } = buildService();
      await expect(
        service.createUploadUrl('ws-1', 'doc-1', 'user-1', {
          filename: 'virus.exe',
          mimeType: 'application/x-msdownload',
          size: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a PENDING row and returns a presigned upload URL for a valid request', async () => {
      const { service, rows } = buildService();
      const result = await service.createUploadUrl('ws-1', 'doc-1', 'user-1', {
        filename: 'notes.txt',
        mimeType: 'text/plain',
        size: 100,
      });

      expect(result.attachment.status).toBe(AttachmentStatus.PENDING);
      expect(result.uploadUrl).toBe('https://minio/upload');
      expect(rows).toHaveLength(1);
    });

    it('propagates 404 for a cross-workspace/missing document', async () => {
      const { service, documentsService } = buildService();
      documentsService.get.mockImplementationOnce(() => {
        throw new NotFoundException('Document not found');
      });

      await expect(
        service.createUploadUrl('ws-1', 'doc-x', 'user-1', {
          filename: 'a.txt',
          mimeType: 'text/plain',
          size: 10,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirm', () => {
    it('marks the attachment READY using the actual size from statObject, not the declared size', async () => {
      const { service, minio } = buildService([
        {
          id: 'att-1',
          documentId: 'doc-1',
          objectKey: 'attachments/doc-1/att-1-file.txt',
          filename: 'file.txt',
          mimeType: 'text/plain',
          size: 999, // declared (wrong) size
          status: AttachmentStatus.PENDING,
          uploadedById: 'user-1',
        },
      ]);
      minio.statObject.mockResolvedValueOnce({ size: 42 });

      const result = await service.confirm('ws-1', 'doc-1', 'att-1');

      expect(result.status).toBe(AttachmentStatus.READY);
      expect(result.size).toBe(42);
    });

    it('rejects and cleans up when the actual uploaded size exceeds the maximum', async () => {
      const { service, rows, minio } = buildService([
        {
          id: 'att-1',
          documentId: 'doc-1',
          objectKey: 'attachments/doc-1/att-1-file.txt',
          filename: 'file.txt',
          mimeType: 'text/plain',
          size: 100,
          status: AttachmentStatus.PENDING,
          uploadedById: 'user-1',
        },
      ]);
      minio.statObject.mockResolvedValueOnce({ size: 999_999_999 });

      await expect(service.confirm('ws-1', 'doc-1', 'att-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(minio.removeObject).toHaveBeenCalled();
      expect(rows).toHaveLength(0);
    });

    it('throws 400 when no object was actually uploaded', async () => {
      const { service, minio } = buildService([
        {
          id: 'att-1',
          documentId: 'doc-1',
          objectKey: 'attachments/doc-1/att-1-file.txt',
          filename: 'file.txt',
          mimeType: 'text/plain',
          size: 100,
          status: AttachmentStatus.PENDING,
          uploadedById: 'user-1',
        },
      ]);
      minio.statObject.mockRejectedValueOnce(new Error('NotFound'));

      await expect(service.confirm('ws-1', 'doc-1', 'att-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 404 for an attachment belonging to a different document (IDOR)', async () => {
      const { service } = buildService([
        {
          id: 'att-1',
          documentId: 'other-doc',
          objectKey: 'x',
          filename: 'x',
          mimeType: 'text/plain',
          size: 1,
          status: AttachmentStatus.PENDING,
          uploadedById: 'user-1',
        },
      ]);

      await expect(service.confirm('ws-1', 'doc-1', 'att-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getDownloadUrl', () => {
    it('rejects a download for an attachment that has not been confirmed yet', async () => {
      const { service } = buildService([
        {
          id: 'att-1',
          documentId: 'doc-1',
          objectKey: 'x',
          filename: 'x',
          mimeType: 'text/plain',
          size: 1,
          status: AttachmentStatus.PENDING,
          uploadedById: 'user-1',
        },
      ]);

      await expect(
        service.getDownloadUrl('ws-1', 'doc-1', 'att-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns a presigned URL for a ready attachment', async () => {
      const { service } = buildService([
        {
          id: 'att-1',
          documentId: 'doc-1',
          objectKey: 'x',
          filename: 'x',
          mimeType: 'text/plain',
          size: 1,
          status: AttachmentStatus.READY,
          uploadedById: 'user-1',
        },
      ]);

      const result = await service.getDownloadUrl('ws-1', 'doc-1', 'att-1');
      expect(result.url).toBe('https://minio/download');
    });
  });

  describe('remove', () => {
    it('deletes both the MinIO object and the DB row', async () => {
      const { service, rows, minio } = buildService([
        {
          id: 'att-1',
          documentId: 'doc-1',
          objectKey: 'attachments/doc-1/att-1-file.txt',
          filename: 'x',
          mimeType: 'text/plain',
          size: 1,
          status: AttachmentStatus.READY,
          uploadedById: 'user-1',
        },
      ]);

      await service.remove('ws-1', 'doc-1', 'att-1');

      expect(minio.removeObject).toHaveBeenCalledWith(
        'attachments/doc-1/att-1-file.txt',
      );
      expect(rows).toHaveLength(0);
    });
  });
});
