import type { CookieOptions, Response } from 'express';

const REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';

const refreshTokenCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/graphql',
};

export function setRefreshTokenCookie(res: Response, rawToken: string, expiresAt: Date): void {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, rawToken, {
    ...refreshTokenCookieOptions,
    expires: expiresAt,
  });
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, refreshTokenCookieOptions);
}
