import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client, type BucketItemStat } from 'minio';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private readonly client: Client;
  /** Same credentials, but pointed at the publicly-reachable endpoint - used
   * only to sign presigned URLs, since those are handed to a browser client
   * that cannot resolve an internal Docker network hostname. */
  private readonly publicClient: Client;
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
    this.publicClient = new Client({
      endPoint: config.minio.publicEndpoint,
      port: config.minio.publicPort,
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
      useSSL: config.minio.publicUseSSL,
      // Without an explicit region, the SDK signs presigned URLs by first
      // making a live getBucketLocation request *to this client's own
      // endpoint* - which fails when publicEndpoint isn't reachable from
      // here (e.g. it's the host machine's address, not resolvable from
      // inside the container). Setting the region short-circuits that
      // lookup entirely; single-region MinIO always reports "us-east-1".
      region: 'us-east-1',
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

  /** Used by AttachmentsService (Stage 6) for direct-to-storage uploads. */
  async getPresignedUploadUrl(
    objectName: string,
    expirySeconds = 300,
  ): Promise<string> {
    return this.publicClient.presignedPutObject(
      this.bucket,
      objectName,
      expirySeconds,
    );
  }

  /** Used by AttachmentsService (Stage 6) for secure download links. */
  async getPresignedDownloadUrl(
    objectName: string,
    expirySeconds = 300,
  ): Promise<string> {
    return this.publicClient.presignedGetObject(
      this.bucket,
      objectName,
      expirySeconds,
    );
  }

  /** Used by AttachmentsService to verify what was actually uploaded
   * (size/etag) rather than trusting client-declared metadata. */
  async statObject(objectName: string): Promise<BucketItemStat> {
    return this.client.statObject(this.bucket, objectName);
  }

  async removeObject(objectName: string): Promise<void> {
    return this.client.removeObject(this.bucket, objectName);
  }
}
