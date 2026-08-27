import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { InvitationResponseDto } from './dto/invitation-response.dto';
import { InvitationsService } from './invitations.service';

@ApiBearerAuth()
@ApiTags('invitations')
@UseGuards(JwtAuthGuard)
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Get('me')
  async mine(
    @CurrentUser() user: JwtPayload,
  ): Promise<InvitationResponseDto[]> {
    return this.invitationsService.listForEmail(user.email);
  }

  // "by-id" variant: for a user acting on an invitation they can already
  // see via GET /invitations/me (no emailed token available client-side,
  // since only its hash is ever stored). Authorization is still enforced
  // by matching the invitation's email to the logged-in user's email.
  @HttpCode(HttpStatus.OK)
  @Post('by-id/:id/accept')
  async acceptById(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ workspaceId: string }> {
    return this.invitationsService.acceptById(id, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('by-id/:id/reject')
  async rejectById(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ success: true }> {
    await this.invitationsService.rejectById(id, user);
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post(':token/accept')
  async accept(
    @Param('token') token: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ workspaceId: string }> {
    return this.invitationsService.accept(token, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':token/reject')
  async reject(
    @Param('token') token: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ success: true }> {
    await this.invitationsService.reject(token, user);
    return { success: true };
  }
}
