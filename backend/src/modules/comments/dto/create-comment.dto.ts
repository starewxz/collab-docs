import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class CreateCommentDto {
  @ApiProperty()
  @IsString()
  @Length(1, 10000)
  content: string;

  @ApiProperty({
    required: false,
    description: 'Omit for a new root comment/thread',
  })
  @IsOptional()
  @IsUUID()
  parentCommentId?: string;

  @ApiProperty({
    required: false,
    type: [String],
    description:
      'Workspace member user ids mentioned in this comment - validated server-side',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  mentionedUserIds?: string[];
}
