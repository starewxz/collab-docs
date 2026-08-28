import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateDocumentDto {
  @ApiProperty()
  @IsString()
  @Length(1, 255)
  title: string;

  @ApiProperty({
    required: false,
    description: 'Parent document id - omit or null for a root document',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}
