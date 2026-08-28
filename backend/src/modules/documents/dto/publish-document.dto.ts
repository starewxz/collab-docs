import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

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

  @ApiProperty({
    required: false,
    enum: ['view', 'edit'],
    default: 'view',
    description:
      "'view' is a read-only public page (default); 'edit' additionally lets anonymous visitors collaboratively edit this one document via the public link.",
  })
  @IsOptional()
  @IsIn(['view', 'edit'])
  mode?: 'view' | 'edit';

  @ApiProperty({
    required: false,
    description:
      'Optional ISO timestamp after which the public link stops resolving (treated the same as unpublished). Omit for a link that never expires.',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
