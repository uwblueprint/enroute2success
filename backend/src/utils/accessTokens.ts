import 'dotenv/config';
import { GraphQLError } from 'graphql';
import jwt from 'jsonwebtoken';
import { StaffType } from '../../generated/client';
import type { AuthenticatedStaff } from './auth';

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret || Buffer.byteLength(jwtSecret, 'utf8') < 32) {
  throw new Error('JWT_SECRET must be set and contain at least 32 bytes');
}

const signingKey = Buffer.from(jwtSecret, 'utf8');

export function generateStaffAccessToken(staff: AuthenticatedStaff): string {
  return jwt.sign({ role: staff.role }, signingKey, {
    algorithm: 'HS256',
    subject: staff.userId,
    expiresIn: 15 * 60,
  });
}

export function verifyStaffAccessToken(token: string): AuthenticatedStaff {
  try {
    const payload = jwt.verify(token, signingKey, { algorithms: ['HS256'] });

    if (
      typeof payload === 'string' ||
      typeof payload.sub !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub) ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp)
    ) {
      throw new Error('Invalid access-token claims');
    }

    const role: unknown = payload.role;

    if (role !== StaffType.ADMIN && role !== StaffType.COACH && role !== StaffType.VOLUNTEER) {
      throw new Error('Invalid access-token role');
    }

    return { userId: payload.sub, role };
  } catch {
    throw new GraphQLError('Invalid or expired access token', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
}
