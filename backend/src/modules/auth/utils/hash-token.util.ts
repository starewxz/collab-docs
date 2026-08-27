import { createHash, createHmac, randomBytes } from 'crypto';

/** 256 bits of entropy, hex-encoded - used as the raw refresh token value. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * HMAC (keyed by JWT_REFRESH_SECRET) rather than a plain hash, so a
 * database leak alone isn't enough to forge a valid-looking hash for a
 * guessed token.
 */
export function hashRefreshToken(rawToken: string, secret: string): string {
  return createHmac('sha256', secret).update(rawToken).digest('hex');
}

/** Invitation tokens aren't session material, so a plain hash is enough. */
export function hashInvitationToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
