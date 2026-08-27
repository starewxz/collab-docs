import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';

function buildService() {
  const usersService = {
    findByEmail: jest.fn(),
    findByEmailWithPassword: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
  };

  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
    verifyAsync: jest.fn(),
  };

  const config = {
    jwt: {
      accessSecret: 'access-secret',
      accessExpiresInSeconds: 900,
      refreshSecret: 'refresh-secret',
      refreshExpiresInSeconds: 60 * 60 * 24 * 30,
    },
  };

  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const metrics = {
    authLoginTotal: { inc: jest.fn() },
  };

  const refreshTokensStore = new Map<string, RefreshToken>();
  let idCounter = 0;
  const refreshTokens = {
    findOne: jest.fn(
      ({ where: { tokenHash } }: { where: { tokenHash: string } }) =>
        Promise.resolve(refreshTokensStore.get(tokenHash) ?? null),
    ),
    create: jest.fn(
      (data: Partial<RefreshToken>) => ({ ...data }) as RefreshToken,
    ),
    save: jest.fn((entity: RefreshToken) => {
      const saved = {
        ...entity,
        id: entity.id ?? `token-${++idCounter}`,
      };
      refreshTokensStore.set(saved.tokenHash, saved);
      return Promise.resolve(saved);
    }),
    update: jest.fn(
      (criteria: { userId: string }, partial: Partial<RefreshToken>) => {
        for (const [hash, row] of refreshTokensStore) {
          if (row.userId === criteria.userId && !row.revokedAt) {
            refreshTokensStore.set(hash, { ...row, ...partial });
          }
        }
        return Promise.resolve({ affected: 1 });
      },
    ),
  };

  const service = new AuthService(
    usersService as never,
    jwtService as unknown as JwtService,
    config as never,
    logger as never,
    metrics as never,
    refreshTokens as never,
  );

  return { service, usersService, refreshTokens, refreshTokensStore };
}

describe('AuthService', () => {
  describe('login (password verification)', () => {
    it('rejects with a generic error when the user does not exist', async () => {
      const { service, usersService } = buildService();
      usersService.findByEmailWithPassword.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects with the same generic error when the password is wrong', async () => {
      const { service, usersService } = buildService();
      const passwordHash = await argon2.hash('correct-password', {
        type: argon2.argon2id,
      });
      usersService.findByEmailWithPassword.mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        passwordHash,
      });

      await expect(
        service.login({
          email: 'alice@example.com',
          password: 'wrong-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('succeeds and issues tokens when the password matches', async () => {
      const { service, usersService } = buildService();
      const passwordHash = await argon2.hash('correct-password', {
        type: argon2.argon2id,
      });
      usersService.findByEmailWithPassword.mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'A',
        passwordHash,
        createdAt: new Date(),
      });

      const result = await service.login({
        email: 'alice@example.com',
        password: 'correct-password',
      });

      expect(result.auth.accessToken).toBe('signed.jwt.token');
      expect(result.auth.user.passwordHash).toBeUndefined();
      expect(result.rawRefreshToken).toHaveLength(64); // 32 bytes hex
    });
  });

  describe('refresh (rotation)', () => {
    it('rotates a valid refresh token and invalidates the old one', async () => {
      const { service, usersService } = buildService();
      usersService.findByEmailWithPassword.mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        passwordHash: await argon2.hash('x', { type: argon2.argon2id }),
        createdAt: new Date(),
      });
      usersService.findById.mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'A',
        createdAt: new Date(),
      });

      const first = await service.login({
        email: 'alice@example.com',
        password: 'x',
      });
      const rotated = await service.refresh(first.rawRefreshToken);

      expect(rotated.rawRefreshToken).not.toBe(first.rawRefreshToken);

      // The old token must now be rejected.
      await expect(service.refresh(first.rawRefreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('detects reuse of an already-rotated token and revokes the session', async () => {
      const { service, usersService } = buildService();
      usersService.findByEmailWithPassword.mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        passwordHash: await argon2.hash('x', { type: argon2.argon2id }),
        createdAt: new Date(),
      });
      usersService.findById.mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'A',
        createdAt: new Date(),
      });

      const first = await service.login({
        email: 'alice@example.com',
        password: 'x',
      });
      const rotated = await service.refresh(first.rawRefreshToken);

      // Reusing the old (now-revoked) token must fail...
      await expect(service.refresh(first.rawRefreshToken)).rejects.toThrow(
        UnauthorizedException,
      );

      // ...and the legitimately-rotated token must ALSO now be dead, since
      // reuse implies the whole chain may be compromised.
      await expect(service.refresh(rotated.rawRefreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an unknown refresh token', async () => {
      const { service } = buildService();
      await expect(service.refresh('not-a-real-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('register', () => {
    it('rejects duplicate emails with 409', async () => {
      const { service, usersService } = buildService();
      usersService.findByEmail.mockResolvedValue({ id: 'existing' });

      await expect(
        service.register({
          email: 'alice@example.com',
          password: 'password123',
          firstName: 'Alice',
          lastName: 'A',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
