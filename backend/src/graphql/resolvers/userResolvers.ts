import { GraphQLError } from 'graphql';
import { Role as PrismaRole } from '../../../generated/client';
import type { Student } from '../../../generated/client';
import type { GraphQLContext } from '../context';
import {
  createStaffAccount,
  EmailInUseError,
  InvalidStaffRoleError,
  InvalidLoginInputError,
  getManagedStudents,
  getUserWithStaff,
  loginStaff,
  loginStudent,
  revokeRefreshToken,
  rotateRefreshToken,
  selectActiveStudent,
  setUserPassword,
} from '../../services/userService';
import type {
  CreateStaffAccountInput,
  LoginInput,
  UserWithStaff,
} from '../../services/userService';
import { requireRole } from '../../utils/auth';
import { clearRefreshTokenCookie, setRefreshTokenCookie } from '../../utils/refreshTokenCookies';

export const userResolvers = {
  Role: {
    COACH: PrismaRole.COACH,
    VOLUNTEER: PrismaRole.VOLUNTEER,
    ADMIN: PrismaRole.ADMIN,
    STUDENT: PrismaRole.STUDENT,
  },

  User: {
    firstName: (user: UserWithStaff) => user.first_name,

    lastName: (user: UserWithStaff) => user.last_name,

    role: (user: UserWithStaff) => user.staff?.role ?? PrismaRole.STUDENT,

    students: async (user: UserWithStaff, _args: unknown, ctx: GraphQLContext) => {
      const caller = requireRole(ctx.auth, [
        PrismaRole.ADMIN,
        PrismaRole.COACH,
        PrismaRole.VOLUNTEER,
        PrismaRole.STUDENT,
      ]);

      if (user.id !== caller.userId) {
        throw new GraphQLError('You can only view your own managed students', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      return getManagedStudents(ctx.prisma, caller.userId);
    },
  },

  Student: {
    membershipId: (student: Student) => student.membership_id,
    firstName: (student: Student) => student.first_name,
    lastName: (student: Student) => student.last_name,
    preferredName: (student: Student) => student.preferred_name,
    birthDate: (student: Student) => student.birth_date.toISOString().slice(0, 10),
  },

  Query: {
    myStudents: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      const caller = requireRole(ctx.auth, [
        PrismaRole.ADMIN,
        PrismaRole.COACH,
        PrismaRole.VOLUNTEER,
        PrismaRole.STUDENT,
      ]);

      return getManagedStudents(ctx.prisma, caller.userId);
    },

    me: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      const caller = requireRole(ctx.auth, [
        PrismaRole.ADMIN,
        PrismaRole.COACH,
        PrismaRole.VOLUNTEER,
        PrismaRole.STUDENT,
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

      return {
        accessToken: session.accessToken,
        user: session.user,
        managedStudents: session.managedStudents,
        activeStudent: session.activeStudent,
      };
    },

    loginStudent: async (_parent: unknown, args: { input: LoginInput }, ctx: GraphQLContext) => {
      try {
        const session = await loginStudent(ctx.prisma, args.input);

        if (!session) {
          throw new GraphQLError('email, membership ID, or password is incorrect', {
            extensions: { code: 'UNAUTHENTICATED' },
          });
        }

        setRefreshTokenCookie(ctx.res, session.refreshToken, session.refreshTokenExpiresAt);

        return {
          accessToken: session.accessToken,
          user: session.user,
          managedStudents: session.managedStudents,
          activeStudent: session.activeStudent,
        };
      } catch (error) {
        if (error instanceof InvalidLoginInputError) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT', field: 'input' },
          });
        }

        throw error;
      }
    },

    selectActiveStudent: async (
      _parent: unknown,
      args: { membershipId: number },
      ctx: GraphQLContext
    ) => {
      const caller = requireRole(ctx.auth, [PrismaRole.STUDENT]);
      const payload = await selectActiveStudent(ctx.prisma, caller.userId, args.membershipId);

      if (!payload) {
        throw new GraphQLError('You do not manage this student', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      return payload;
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

        return {
          accessToken: session.accessToken,
          user: session.user,
          managedStudents: session.managedStudents,
          activeStudent: session.activeStudent,
        };
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
      requireRole(ctx.auth, [PrismaRole.ADMIN]);

      try {
        return await createStaffAccount(ctx.prisma, args);
      } catch (error) {
        if (error instanceof InvalidStaffRoleError) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT', field: 'role' },
          });
        }

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
      requireRole(ctx.auth, [PrismaRole.ADMIN]);

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
