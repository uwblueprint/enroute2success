import { GraphQLError } from 'graphql';
import type { StaffType } from '../generated/client';

export interface AuthenticatedStaff {
  userId: string;
  role: StaffType;
}

export function requireRole(
  caller: AuthenticatedStaff | null,
  allowedRoles: readonly StaffType[]
): AuthenticatedStaff {
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
