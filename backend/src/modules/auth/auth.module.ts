import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
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
    ThrottlerModule.forRoot([
      { name: 'login', ttl: 60000, limit: 5 },
      { name: 'register', ttl: 60000, limit: 20 },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
