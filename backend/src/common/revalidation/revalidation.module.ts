import { Global, Module } from '@nestjs/common';
import { RevalidationService } from './revalidation.service';

@Global()
@Module({
  providers: [RevalidationService],
  exports: [RevalidationService],
})
export class RevalidationModule {}
