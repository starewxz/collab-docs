import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsPositive, IsString, Length } from 'class-validator';

export class CreateAttachmentDto {
  @ApiProperty()
  @IsString()
  @Length(1, 255)
  filename: string;

  @ApiProperty({
    description: 'Declared MIME type - validated against an allowlist',
  })
  @IsString()
  @Length(1, 255)
  mimeType: string;

  @ApiProperty({
    description:
      'Declared size in bytes - re-validated against the actual upload on confirm',
  })
  @IsInt()
  @IsPositive()
  size: number;
}
