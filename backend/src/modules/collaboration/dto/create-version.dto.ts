import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class CreateVersionDto {
  @ApiProperty({
    required: false,
    description: 'Optional user-supplied label for this snapshot',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  label?: string;
}
