import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';

export type DocumentPlacement = 'before' | 'after';

export class MoveDocumentDto {
  @ApiProperty({
    nullable: true,
    description: 'New parent id, or null to move to the workspace root',
  })
  @ValidateIf((o: MoveDocumentDto) => o.parentId !== null)
  @IsUUID()
  parentId: string | null;

  @ApiProperty({
    required: false,
    description:
      'Sibling id to position relative to; omit to append at the end',
  })
  @IsOptional()
  @IsUUID()
  referenceId?: string;

  @ApiProperty({
    required: false,
    enum: ['before', 'after'],
    description: "Only used with referenceId - defaults to 'after'",
  })
  @IsOptional()
  @IsIn(['before', 'after'])
  placement?: DocumentPlacement;
}
