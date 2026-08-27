import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class CreateWorkspaceDto {
  @ApiProperty()
  @IsString()
  @Length(1, 255)
  name: string;
}
