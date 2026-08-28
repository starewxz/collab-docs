import { ApiProperty } from '@nestjs/swagger';

export class DocumentSearchResultDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({
    nullable: true,
    description: 'Highlighted excerpt of the match, if any',
  })
  snippet: string | null;

  @ApiProperty({ nullable: true })
  parentId: string | null;

  @ApiProperty()
  updatedAt: Date;
}
