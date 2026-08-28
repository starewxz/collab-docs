import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetRestrictedDto {
  @ApiProperty()
  @IsBoolean()
  restricted: boolean;
}
