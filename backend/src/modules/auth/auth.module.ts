import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../../config/app-config.module';
import { AppConfigService } from '../../config/app-config.service';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([RefreshToken]),
    JwtModule.register({}),
    // Separate buckets: login is brute-force-sensitive and tightly capped,
    // register is spam-sensitive but must tolerate normal multi-account
    // usage (shared office/NAT IPs, test suites) without shared contention.
    // Limits are env-configurable (see ThrottleConfig) so the e2e suite can
    // raise the register bucket for its own process without touching the
    // production default.
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => [
        {
          name: 'login',
          ttl: appConfig.throttle.loginTtlMs,
          limit: appConfig.throttle.loginLimit,
        },
        {
          name: 'register',
          ttl: appConfig.throttle.registerTtlMs,
          limit: appConfig.throttle.registerLimit,
        },
      ],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
