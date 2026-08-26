import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { MinioService } from '../../storage/minio.service';

@Injectable()
export class MinioHealthIndicator {
  constructor(
    private readonly minioService: MinioService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async pingCheck(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.minioService.bucketExists();
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: (error as Error).message });
    }
  }
}
