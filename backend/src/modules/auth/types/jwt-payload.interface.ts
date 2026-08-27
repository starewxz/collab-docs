/**
 * Minimal access token payload. Never embed workspace roles here - roles
 * can change after the token is issued, so authorization always resolves
 * current membership from the database instead of trusting claims.
 */
export interface JwtPayload {
  sub: string;
  email: string;
}
