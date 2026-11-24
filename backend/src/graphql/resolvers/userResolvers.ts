import { GraphQLError } from 'graphql';
import { Role as PrismaRole } from '../../../generated/client';
import type { Student } from '../../../generated/client';
import type { GraphQLContext } from '../context';
import {
  AccountDeactivatedError,
  AccountNotFoundError,
  completeAccountSetup,
  createManagedStudent,
  EmailInUseError,
  InvalidAccountSetupTokenError,
  InvalidLoginInputError,
  getManagedStudents,
  getStudents,
  getUserWithStaff,
  IncorrectPasswordError,
  loginStaff,
  loginStudent,
  persistActiveStudent,
  requestAccountSetup,
  revokeRefreshToken,
  rotateRefreshToken,
  selectActiveStudent,
  setUserPassword,
} from '../../services/userService';
import type {
  CompleteAccountSetupInput,
  LoginInput,
  StudentInput,
  UserWithStaff,
} from '../../services/userService';
import { requireRole } from '../../utils/auth';
import { clearRefreshTokenCookie, setRefreshTokenCookie } from '../../utils/refreshTokenCookies';
import {
  validateEmail,
  validateLoginPassword,
  validatePassword,
  validatePersonName,
  validatePhone,
  validatePositiveInt,
  validateStudentInput,
} from '../../utils/validation';

function toLoginError(error: unknown, identifierField: 'email' | 'membershipId'): unknown {
  if (error instanceof AccountNotFoundError) {
    return new GraphQLError(error.message, {
      extensions: { code: 'ACCOUNT_NOT_FOUND', field: identifierField },
    });
  }

  if (error instanceof AccountDeactivatedError) {
    return new GraphQLError(error.message, { extensions: { code: 'ACCOUNT_DEACTIVATED' } });
  }

  if (error instanceof IncorrectPasswordError) {
    return new GraphQLError(error.message, {
      extensions: { code: 'INCORRECT_PASSWORD', field: 'password' },
    });
  }

  return error;
}

const loginRetryError = () =>
  new GraphQLError('Unable to log in. Please try again.', {
    extensions: { code: 'UNAUTHENTICATED' },
  });

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

    preferredName: (user: UserWithStaff) => user.preferred_name,

    phoneNumber: (user: UserWithStaff) => user.phone_number,

    role: (user: UserWithStaff) => user.staff?.role ?? PrismaRole.STUDENT,

    deactivatedAt: (user: UserWithStaff) => user.deactivated_at?.toISOString() ?? null,

    createdAt: (user: UserWithStaff) => user.created_at.toISOString(),

    students: async (user: UserWithStaff, _args: unknown, ctx: GraphQLContext) => {
      const caller = requireRole(ctx.auth, [
        PrismaRole.ADMIN,
        PrismaRole.COACH,
        PrismaRole.VOLUNTEER,
        PrismaRole.STUDENT,
      ]);

      if (
        user.id !== caller.userId &&
        !(caller.role === PrismaRole.ADMIN) &&
        !(caller.role === PrismaRole.COACH)
      ) {
        throw new GraphQLError('You can only view your own managed students', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      return getManagedStudents(ctx.prisma, user.id);
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
    allStudents: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireRole(ctx.auth, [PrismaRole.ADMIN, PrismaRole.COACH]);

      return getStudents(ctx.prisma);
    },

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
      const email = validateEmail(args.email);
      const password = validateLoginPassword(args.password);

      let session;

      try {
        session = await loginStaff(ctx.prisma, email, password);
      } catch (error) {
        throw toLoginError(error, 'email');
      }

      if (!session) {
        throw loginRetryError();
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
      const { email, membershipId, password } = args.input;
      const input: LoginInput = {
        email: email != null ? validateEmail(email) : null,
        membershipId:
          membershipId != null ? validatePositiveInt(membershipId, 'membershipId') : null,
        password: validateLoginPassword(password),
      };

      try {
        const session = await loginStudent(ctx.prisma, input);

        if (!session) {
          throw loginRetryError();
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

        throw toLoginError(error, input.email != null ? 'email' : 'membershipId');
      }
    },

    selectActiveStudent: async (
      _parent: unknown,
      args: { membershipId: number },
      ctx: GraphQLContext
    ) => {
      const caller = requireRole(ctx.auth, [PrismaRole.STUDENT]);
      const membershipId = validatePositiveInt(args.membershipId, 'membershipId');
      const payload = await selectActiveStudent(ctx.prisma, caller.userId, membershipId);

      if (!payload) {
        throw new GraphQLError('You do not manage this student', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      await persistActiveStudent(
        ctx.prisma,
        caller.userId,
        ctx.req.cookies?.refresh_token,
        membershipId
      );

      return payload;
    },

    createManagedStudent: async (
      _parent: unknown,
      args: { student: StudentInput },
      ctx: GraphQLContext
    ) => {
      const caller = requireRole(ctx.auth, [PrismaRole.STUDENT]);

      const student = validateStudentInput(args.student);

      const payload = await createManagedStudent(ctx.prisma, caller.userId, student);

      if (!payload) {
        throw new GraphQLError('Unable to add a student for this account', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      if (payload.activeStudent) {
        await persistActiveStudent(
          ctx.prisma,
          caller.userId,
          ctx.req.cookies?.refresh_token,
          payload.activeStudent.membership_id
        );
      }

      return payload;
    },

    requestAccountSetup: async (_parent: unknown, args: { email: string }, ctx: GraphQLContext) => {
      const email = validateEmail(args.email);

      try {
        return await requestAccountSetup(ctx.prisma, email);
      } catch (error) {
        if (error instanceof EmailInUseError) {
          throw new GraphQLError('An account with this email already exists', {
            extensions: { code: 'BAD_USER_INPUT', field: 'email' },
          });
        }

        throw error;
      }
    },

    completeAccountSetup: async (
      _parent: unknown,
      args: CompleteAccountSetupInput,
      ctx: GraphQLContext
    ) => {
      const input: CompleteAccountSetupInput = {
        token: args.token,
        newPassword: validatePassword(args.newPassword, 'newPassword'),
        firstName: validatePersonName(args.firstName, 'firstName'),
        lastName: validatePersonName(args.lastName, 'lastName'),
        phoneNumber: validatePhone(args.phoneNumber),
        student: validateStudentInput(args.student),
      };

      try {
        const session = await completeAccountSetup(ctx.prisma, input);
        setRefreshTokenCookie(ctx.res, session.refreshToken, session.refreshTokenExpiresAt);

        return {
          accessToken: session.accessToken,
          user: session.user,
          managedStudents: session.managedStudents,
          activeStudent: session.activeStudent,
        };
      } catch (error) {
        if (error instanceof InvalidAccountSetupTokenError) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT', field: 'token' },
          });
        }

        if (error instanceof EmailInUseError) {
          throw new GraphQLError('An account with this email already exists', {
            extensions: { code: 'BAD_USER_INPUT', field: 'email' },
          });
        }

        throw error;
      }
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

    adminSetPassword: async (
      _parent: unknown,
      args: { userId: string; newPassword: string },
      ctx: GraphQLContext
    ) => {
      requireRole(ctx.auth, [PrismaRole.ADMIN]);

      const newPassword = validatePassword(args.newPassword, 'newPassword');
      const updated = await setUserPassword(ctx.prisma, args.userId, newPassword);

      if (!updated) {
        throw new GraphQLError('User not found', {
          extensions: { code: 'BAD_USER_INPUT', field: 'userId' },
        });
      }

      return true;
    },
  },
};
