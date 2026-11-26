import { GraphQLError } from 'graphql';
import { Role } from '../../../generated/client';
import {
  CannotDeactivateSelfError,
  createUser,
  deactivateUser,
  LastAdminError,
  listUsers,
  reactivateUser,
  UserNotFoundError,
} from '../../services/adminService';
import type { CreateUserInput } from '../../services/adminService';
import { EmailInUseError } from '../../services/userService';
import type { UserWithStaff } from '../../services/userService';
import { requireRole } from '../../utils/auth';
import {
  validateEmail,
  validatePassword,
  validatePersonName,
  validatePhone,
} from '../../utils/validation';
import type { GraphQLContext } from '../context';

function toAdminError(error: unknown, userId?: string): unknown {
  if (error instanceof UserNotFoundError) {
    return new GraphQLError(error.message, { extensions: { code: 'NOT_FOUND', id: userId } });
  }

  if (error instanceof CannotDeactivateSelfError) {
    return new GraphQLError(error.message, { extensions: { code: 'CANNOT_DEACTIVATE_SELF' } });
  }

  if (error instanceof LastAdminError) {
    return new GraphQLError(error.message, { extensions: { code: 'LAST_ADMIN' } });
  }

  if (error instanceof EmailInUseError) {
    return new GraphQLError(error.message, {
      extensions: { code: 'BAD_USER_INPUT', field: 'email' },
    });
  }

  return error;
}

export const adminResolvers = {
  Query: {
    users: async (
      _parent: unknown,
      args: { role?: Role | null; includeDeactivated?: boolean | null },
      ctx: GraphQLContext
    ): Promise<UserWithStaff[]> => {
      requireRole(ctx.auth, [Role.ADMIN]);

      return listUsers(ctx.prisma, {
        role: args.role ?? null,
        includeDeactivated: args.includeDeactivated ?? false,
      });
    },
  },

  Mutation: {
    createUser: async (
      _parent: unknown,
      args: CreateUserInput,
      ctx: GraphQLContext
    ): Promise<UserWithStaff> => {
      requireRole(ctx.auth, [Role.ADMIN]);

      const input: CreateUserInput = {
        firstName: validatePersonName(args.firstName, 'firstName'),
        lastName: validatePersonName(args.lastName, 'lastName'),
        email: validateEmail(args.email),
        phoneNumber: validatePhone(args.phoneNumber),
        password: validatePassword(args.password),
        role: args.role,
      };

      try {
        return await createUser(ctx.prisma, input);
      } catch (error) {
        throw toAdminError(error);
      }
    },

    deactivateUser: async (
      _parent: unknown,
      args: { userId: string },
      ctx: GraphQLContext
    ): Promise<UserWithStaff> => {
      const caller = requireRole(ctx.auth, [Role.ADMIN]);

      try {
        return await deactivateUser(ctx.prisma, caller.userId, args.userId);
      } catch (error) {
        throw toAdminError(error, args.userId);
      }
    },

    reactivateUser: async (
      _parent: unknown,
      args: { userId: string },
      ctx: GraphQLContext
    ): Promise<UserWithStaff> => {
      requireRole(ctx.auth, [Role.ADMIN]);

      try {
        return await reactivateUser(ctx.prisma, args.userId);
      } catch (error) {
        throw toAdminError(error, args.userId);
      }
    },
  },
};
