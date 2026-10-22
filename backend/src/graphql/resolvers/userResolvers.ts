import { GraphQLError } from 'graphql';
import { StaffType as PrismaStaffType } from '../../../generated/client';
import type { GraphQLContext } from '../context';
import {
  createStaffAccount,
  EmailInUseError,
  getUserWithStaff,
  loginStaff,
  revokeRefreshToken,
  rotateRefreshToken,
  setUserPassword,
} from '../../services/userService';
import type { CreateStaffAccountInput, UserWithStaff } from '../../services/userService';
import { requireRole } from '../../utils/auth';
import { clearRefreshTokenCookie, setRefreshTokenCookie } from '../../utils/refreshTokenCookies';

export const userResolvers = {
  StaffType: {
    COACH: PrismaStaffType.COACH,
    VOLUNTEER: PrismaStaffType.VOLUNTEER,
    ADMIN: PrismaStaffType.ADMIN,
  },

  User: {
    firstName: (user: UserWithStaff) => user.first_name,

    lastName: (user: UserWithStaff) => user.last_name,

    role: (user: UserWithStaff) => user.staff?.staffType ?? null,
  },

  Query: {
    me: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      const caller = requireRole(ctx.auth, [
        PrismaStaffType.ADMIN,
        PrismaStaffType.COACH,
        PrismaStaffType.VOLUNTEER,
      ]);
      const user = await getUserWithStaff(ctx.prisma, caller.userId);

      if (!user) {
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      return user;
    },
  },

  Mutation: {
    loginStaff: async (
      _parent: unknown,
      args: { email: string; password: string },
      ctx: GraphQLContext
    ) => {
      const session = await loginStaff(ctx.prisma, args.email, args.password);

      if (!session) {
        throw new GraphQLError('email or password is incorrect', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      setRefreshTokenCookie(ctx.res, session.refreshToken, session.refreshTokenExpiresAt);

      return { accessToken: session.accessToken, user: session.user };
    },

    refreshAccessToken: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      try {
        const rawToken: unknown = ctx.req.cookies?.refresh_token;

        if (typeof rawToken !== 'string' || rawToken.length === 0) {
          throw new Error('Missing refresh token');
        }

        const session = await rotateRefreshToken(ctx.prisma, rawToken);

        if (!session) {
          throw new Error('Invalid refresh token');
        }

        setRefreshTokenCookie(ctx.res, session.refreshToken, session.refreshTokenExpiresAt);

        return { accessToken: session.accessToken, user: session.user };
      } catch {
        clearRefreshTokenCookie(ctx.res);
        throw new GraphQLError('Invalid or expired refresh token', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }
    },

    logout: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      try {
        const rawToken: unknown = ctx.req.cookies?.refresh_token;

        if (typeof rawToken === 'string' && rawToken.length > 0) {
          await revokeRefreshToken(ctx.prisma, rawToken);
        }
      } finally {
        clearRefreshTokenCookie(ctx.res);
      }

      return true;
    },

    createStaffAccount: async (
      _parent: unknown,
      args: CreateStaffAccountInput,
      ctx: GraphQLContext
    ) => {
      requireRole(ctx.auth, [PrismaStaffType.ADMIN]);

      try {
        return await createStaffAccount(ctx.prisma, args);
      } catch (error) {
        if (error instanceof EmailInUseError) {
          throw new GraphQLError('Email is already in use', {
            extensions: { code: 'BAD_USER_INPUT', field: 'email' },
          });
        }

        throw error;
      }
    },

    adminSetPassword: async (
      _parent: unknown,
      args: { userId: string; newPassword: string },
      ctx: GraphQLContext
    ) => {
      requireRole(ctx.auth, [PrismaStaffType.ADMIN]);

      const updated = await setUserPassword(ctx.prisma, args.userId, args.newPassword);

      if (!updated) {
        throw new GraphQLError('User not found', {
          extensions: { code: 'BAD_USER_INPUT', field: 'userId' },
        });
      }

      return true;
    },
  },
};
