import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async getMetrics(@Res({ passthrough: true }) res: Response): Promise<string> {
    res.setHeader('Content-Type', this.metrics.contentType);
    return this.metrics.getMetrics();
  }
}
