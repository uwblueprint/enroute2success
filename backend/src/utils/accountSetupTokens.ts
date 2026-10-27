import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';

const ACCOUNT_SETUP_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

export function generateAccountSetupToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashAccountSetupToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function getAccountSetupTokenExpiry(): Date {
  return new Date(Date.now() + ACCOUNT_SETUP_TOKEN_LIFETIME_MS);
}

export function getAccountSetupUrl(rawToken: string): string {
  const url = process.env.ACCOUNT_SETUP_URL
    ? new URL(process.env.ACCOUNT_SETUP_URL)
    : new URL('/complete-account-setup', process.env.CORS_ORIGIN ?? 'http://localhost:5173');

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('ACCOUNT_SETUP_URL must use HTTP or HTTPS');
  }

  url.searchParams.set('token', rawToken);
  return url.toString();
}
