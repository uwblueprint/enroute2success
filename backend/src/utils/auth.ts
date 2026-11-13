import { GraphQLError } from 'graphql';
import { Role } from '../../generated/client';

export const staffRoles = [Role.ADMIN, Role.COACH, Role.VOLUNTEER] as const;

export interface AuthenticatedUser {
  userId: string;
  role: Role;
  activeStudentId: number | null;
}

export function requireRole(
  caller: AuthenticatedUser | null,
  allowedRoles: readonly Role[]
): AuthenticatedUser {
  if (caller === null) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  if (!allowedRoles.includes(caller.role)) {
    throw new GraphQLError('Insufficient permissions', {
      extensions: { code: 'FORBIDDEN' },
    });
  }

  return caller;
}
