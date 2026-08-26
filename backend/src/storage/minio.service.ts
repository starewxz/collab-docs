import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from 'minio';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private readonly client: Client;
  private readonly bucket: string;

  constructor(config: AppConfigService) {
    this.bucket = config.minio.bucket;
    this.client = new Client({
      endPoint: config.minio.endpoint,
      port: config.minio.port,
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
      useSSL: config.minio.useSSL,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  getClient(): Client {
    return this.client;
  }

  async bucketExists(): Promise<boolean> {
    return this.client.bucketExists(this.bucket);
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.bucketExists();
    if (!exists) {
      await this.client.makeBucket(this.bucket);
      this.logger.log(`Created MinIO bucket "${this.bucket}"`);
    }
  }

  /** Reserved for Stage 2 file upload flows. */
  async getPresignedUploadUrl(
    objectName: string,
    expirySeconds = 300,
  ): Promise<string> {
    return this.client.presignedPutObject(
      this.bucket,
      objectName,
      expirySeconds,
    );
  }

  /** Reserved for Stage 2 file download flows. */
  async getPresignedDownloadUrl(
    objectName: string,
    expirySeconds = 300,
  ): Promise<string> {
    return this.client.presignedGetObject(
      this.bucket,
      objectName,
      expirySeconds,
    );
  }
}
