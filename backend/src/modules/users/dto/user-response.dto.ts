import { ApiProperty } from '@nestjs/swagger';
import type { User } from '../user.entity';

/**
 * Public-safe user shape. Never includes passwordHash or token data -
 * controllers must always map through this rather than returning entities
 * directly.
 */
export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty()
  createdAt: Date;

  static fromEntity(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.firstName = user.firstName;
    dto.lastName = user.lastName;
    dto.createdAt = user.createdAt;
    return dto;
  }
}
