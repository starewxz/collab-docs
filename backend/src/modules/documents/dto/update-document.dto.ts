import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class UpdateDocumentDto {
  @ApiProperty()
  @IsString()
  @Length(1, 255)
  title: string;
}
