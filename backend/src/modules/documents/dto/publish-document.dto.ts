import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class PublishDocumentDto {
  @ApiProperty({
    required: false,
    description:
      'Optional custom slug (normalized: lowercased, non-alphanumerics collapsed to hyphens). Omit to reuse the current slug (if any) or generate one from the title.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Matches(/^[a-zA-Z0-9 _-]+$/, {
    message: 'slug may only contain letters, numbers, spaces, - and _',
  })
  slug?: string;
}
