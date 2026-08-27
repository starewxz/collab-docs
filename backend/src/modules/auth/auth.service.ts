import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { PinoLogger } from 'nestjs-pino';
import { IsNull, LessThan, Repository } from 'typeorm';
import { AppConfigService } from '../../config/app-config.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RefreshToken } from './entities/refresh-token.entity';
import { generateOpaqueToken, hashRefreshToken } from './utils/hash-token.util';

export interface TokenPair {
  auth: AuthResponseDto;
  rawRefreshToken: string;
  refreshExpiresAt: Date;
  refreshTokenEntity: RefreshToken;
}

const GENERIC_LOGIN_ERROR = 'Invalid email or password';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
  ) {
    this.logger.setContext(AuthService.name);
  }

  async register(dto: RegisterDto, userAgent?: string): Promise<TokenPair> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });

    this.logger.info(
      { event: 'user_registered', userId: user.id },
      'user_registered',
    );

    return this.issueTokenPair(user, userAgent);
  }

  async login(dto: LoginDto, userAgent?: string): Promise<TokenPair> {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    if (!user) {
      this.metrics.authLoginTotal.inc({ result: 'failure' });
      this.logger.info(
        { event: 'login_failed', reason: 'no_such_user' },
        'login_failed',
      );
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const passwordMatches = await argon2.verify(
      user.passwordHash,
      dto.password,
    );
    if (!passwordMatches) {
      this.metrics.authLoginTotal.inc({ result: 'failure' });
      this.logger.info(
        { event: 'login_failed', reason: 'bad_password', userId: user.id },
        'login_failed',
      );
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    this.metrics.authLoginTotal.inc({ result: 'success' });
    this.logger.info(
      { event: 'login_succeeded', userId: user.id },
      'login_succeeded',
    );

    return this.issueTokenPair(user, userAgent);
  }

  async refresh(
    rawRefreshToken: string,
    userAgent?: string,
  ): Promise<TokenPair> {
    const tokenHash = hashRefreshToken(
      rawRefreshToken,
      this.config.jwt.refreshSecret,
    );
    const existing = await this.refreshTokens.findOne({ where: { tokenHash } });

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (existing.revokedAt) {
      // The same (rotated-away) token was presented again - treat as a
      // possible theft and kill every active session for this user.
      await this.refreshTokens.update(
        { userId: existing.userId, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      this.logger.warn(
        { event: 'refresh_reuse_detected', userId: existing.userId },
        'refresh_reuse_detected',
      );
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.usersService.findById(existing.userId);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const pair = await this.issueTokenPair(user, userAgent);

    existing.revokedAt = new Date();
    existing.replacedByTokenId = pair.refreshTokenEntity.id;
    await this.refreshTokens.save(existing);

    return pair;
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }
    const tokenHash = hashRefreshToken(
      rawRefreshToken,
      this.config.jwt.refreshSecret,
    );
    const existing = await this.refreshTokens.findOne({ where: { tokenHash } });
    if (existing && !existing.revokedAt) {
      existing.revokedAt = new Date();
      await this.refreshTokens.save(existing);
      this.logger.info({ event: 'logout', userId: existing.userId }, 'logout');
    }
  }

  /** Best-effort cleanup; not on the hot path of any request. */
  async purgeExpiredTokens(): Promise<void> {
    await this.refreshTokens.delete({ expiresAt: LessThan(new Date()) });
  }

  private async issueTokenPair(
    user: User,
    userAgent?: string,
  ): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email },
      {
        secret: this.config.jwt.accessSecret,
        expiresIn: this.config.jwt.accessExpiresInSeconds,
      },
    );

    const rawRefreshToken = generateOpaqueToken();
    const tokenHash = hashRefreshToken(
      rawRefreshToken,
      this.config.jwt.refreshSecret,
    );
    const refreshExpiresAt = new Date(
      Date.now() + this.config.jwt.refreshExpiresInSeconds * 1000,
    );

    const refreshTokenEntity = await this.refreshTokens.save(
      this.refreshTokens.create({
        userId: user.id,
        tokenHash,
        expiresAt: refreshExpiresAt,
        userAgent: userAgent?.slice(0, 512) ?? null,
      }),
    );

    const auth = new AuthResponseDto();
    auth.accessToken = accessToken;
    auth.expiresIn = this.config.jwt.accessExpiresInSeconds;
    auth.user = UserResponseDto.fromEntity(user);

    return { auth, rawRefreshToken, refreshExpiresAt, refreshTokenEntity };
  }
}
