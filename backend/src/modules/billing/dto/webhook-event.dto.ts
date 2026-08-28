import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID } from 'class-validator';

export class WebhookEventDto {
  @ApiProperty()
  @IsString()
  eventId: string;

  @ApiProperty()
  @IsUUID()
  workspaceId: string;

  @ApiProperty({ enum: ['checkout.completed', 'subscription.canceled'] })
  @IsIn(['checkout.completed', 'subscription.canceled'])
  type: 'checkout.completed' | 'subscription.canceled';

  @ApiProperty({ enum: ['pro'], required: false })
  @IsIn(['pro'])
  plan?: 'pro';
}
