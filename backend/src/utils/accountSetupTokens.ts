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

export function getAccountSetupBaseUrl(): URL {
  const configuredUrl = process.env.ACCOUNT_SETUP_URL?.trim();

  if (!configuredUrl && process.env.NODE_ENV !== 'development') {
    throw new Error('ACCOUNT_SETUP_URL is required outside development');
  }

  let url: URL;

  try {
    url = new URL(configuredUrl || 'http://localhost:5173/complete-account-setup');
  } catch {
    throw new Error('ACCOUNT_SETUP_URL must be an absolute HTTP or HTTPS URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('ACCOUNT_SETUP_URL must use HTTP or HTTPS');
  }

  if (url.username || url.password) {
    throw new Error('ACCOUNT_SETUP_URL must not include credentials');
  }

  return url;
}

export function getAccountSetupUrl(rawToken: string): string {
  const url = getAccountSetupBaseUrl();

  url.searchParams.set('token', rawToken);
  return url.toString();
}
