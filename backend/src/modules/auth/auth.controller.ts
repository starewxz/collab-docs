import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UsersService } from '../users/users.service';
import { AuthService, TokenPair } from './auth.service';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './constants';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { JwtPayload } from './types/jwt-payload.interface';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly config: AppConfigService,
  ) {}

  // Limit/ttl for the 'register' bucket come from the module-level
  // ThrottlerModule registration (env-configurable) - not overridden here,
  // so the test env's higher limit actually takes effect.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ login: true })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const pair = await this.authService.register(
      dto,
      req.headers['user-agent'],
    );
    this.setRefreshCookie(res, pair);
    return pair.auth;
  }

  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ register: true })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const pair = await this.authService.login(dto, req.headers['user-agent']);
    this.setRefreshCookie(res, pair);
    return pair.auth;
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as
      string | undefined;
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const pair = await this.authService.refresh(
      rawRefreshToken,
      req.headers['user-agent'],
    );
    this.setRefreshCookie(res, pair);
    return pair.auth;
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as
      string | undefined;
    await this.authService.logout(rawRefreshToken);
    res.clearCookie(REFRESH_COOKIE_NAME, {
      path: REFRESH_COOKIE_PATH,
      domain: this.config.app.cookieDomain,
    });
    return { success: true };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: JwtPayload): Promise<UserResponseDto> {
    const found = await this.usersService.findById(user.sub);
    if (!found) {
      throw new UnauthorizedException();
    }
    return UserResponseDto.fromEntity(found);
  }

  private setRefreshCookie(res: Response, pair: TokenPair): void {
    res.cookie(REFRESH_COOKIE_NAME, pair.rawRefreshToken, {
      httpOnly: true,
      secure: this.config.isProductionLike,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      domain: this.config.app.cookieDomain,
      expires: pair.refreshExpiresAt,
    });
  }
}
