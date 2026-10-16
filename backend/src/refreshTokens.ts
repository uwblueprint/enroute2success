import { createHash, randomBytes } from 'node:crypto';

const REFRESH_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function getRefreshTokenExpiry(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS);
}
