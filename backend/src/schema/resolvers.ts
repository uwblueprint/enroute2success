import { randomUUID } from 'node:crypto';
import { GraphQLError } from 'graphql';
import { UUIDResolver } from 'graphql-scalars';
import { Prisma, StaffType as PrismaStaffType } from '../../generated/client';
import type { User, StaffUsers, session, session_status } from '../../generated/client';
import type { GraphQLContext } from '../context';
import { currentLocalMonthYear, monthRangeUtc } from '../datetime';
import { generateStaffAccessToken } from '../accessTokens';
import { requireRole } from '../auth';
import { hashPassword, verifyPassword } from '../passwords';
import { generateRefreshToken, getRefreshTokenExpiry, hashRefreshToken } from '../refreshTokens';
import { clearRefreshTokenCookie, setRefreshTokenCookie } from '../refreshTokenCookies';

type SessionsArgs = {
  month?: number | null;
  year?: number | null;
  sessionStatuses?: session_status[] | null;
};

type SessionArgs = {
  id: string;
};

// A database user with their staff relation loaded.
// The staff relation can be null.
type UserWithStaff = User & {
  staff: StaffUsers | null;
};

export const resolvers = {
  UUID: UUIDResolver,

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
      const user = await ctx.prisma.user.findUnique({
        where: { id: caller.userId },
        include: { staff: true },
      });

      if (!user) {
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      return user;
    },

    health: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      let databaseConnected = false;

      try {
        await ctx.prisma.$queryRaw`SELECT 1`;
        databaseConnected = true;
      } catch (err) {
        console.error('[health] database check failed:', err);
        databaseConnected = false;
      }

      return {
        ok: true,
        databaseConnected,
        timestamp: new Date().toISOString(),
      };
    },

    // TODO(auth): There is no auth/roles layer yet, so every status — including
    // DRAFT and CANCELLED — is readable by anyone. Once auth lands, restrict
    // DRAFT (and likely CANCELLED) to privileged roles and default anonymous
    // callers to SCHEDULED only.
    sessions: async (_parent: unknown, args: SessionsArgs, ctx: GraphQLContext) => {
      const { month, year, sessionStatuses } = args;

      // Supplying only one of month/year is ambiguous for a calendar month view.
      const hasMonth = month != null;
      const hasYear = year != null;
      if (hasMonth !== hasYear) {
        throw new GraphQLError(
          'month and year must be provided together (or omit both for the current month)',
          { extensions: { code: 'BAD_USER_INPUT' } }
        );
      }
      if (hasMonth && (month! < 1 || month! > 12)) {
        throw new GraphQLError('month must be between 1 and 12', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      // Resolve the target local month. No params -> current local month.
      const target = hasMonth ? { month: month!, year: year! } : currentLocalMonthYear();

      // Compute UTC boundaries from the ORG's local timezone so sessions near
      // midnight land in the correct local month.
      const range = monthRangeUtc(target.year, target.month);

      return ctx.prisma.session.findMany({
        where: {
          start_datetime: { gte: range.gte, lt: range.lt },
          // An empty list or null means "all statuses".
          ...(sessionStatuses?.length && { status: { in: sessionStatuses } }),
        },
        orderBy: { start_datetime: 'asc' },
      });
    },

    // TODO(auth): Same lockdown as `sessions` — once auth exists, a nonexistent
    // ID and an unauthorized-status ID should be indistinguishable (both
    // NOT_FOUND) so DRAFT/CANCELLED sessions can't be probed by id.
    session: async (_parent: unknown, args: SessionArgs, ctx: GraphQLContext): Promise<session> => {
      const found = await ctx.prisma.session.findUnique({
        where: { id: args.id },
      });
      if (!found) {
        throw new GraphQLError('Session not found', {
          extensions: { code: 'NOT_FOUND', id: args.id },
        });
      }
      return found;
    },
  },

  Session: {
    startDatetime: (s: session) => s.start_datetime.toISOString(),
    endDatetime: (s: session) => s.end_datetime.toISOString(),
    maxAttendees: (s: session) => s.max_attendees,
  },

  Mutation: {
    loginStaff: async (
      _parent: unknown,
      args: { email: string; password: string },
      ctx: GraphQLContext
    ) => {
      const user = await ctx.prisma.user.findUnique({
        where: { email: args.email },
        include: { staff: true },
      });

      let passwordMatches = false;

      if (user) {
        passwordMatches = await verifyPassword(user.password_hash, args.password);
      } else {
        await hashPassword(args.password);
      }

      if (!user || !user.staff || !passwordMatches) {
        throw new GraphQLError('email or password is incorrect', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      const accessToken = generateStaffAccessToken({
        userId: user.id,
        role: user.staff.staffType,
      });
      const refreshToken = generateRefreshToken();
      const expiresAt = getRefreshTokenExpiry();

      await ctx.prisma.$transaction(
        async (tx) => {
          const [currentUser] = await tx.$queryRaw<Array<{ password_hash: string }>>`
            SELECT "password_hash" FROM "users"
            WHERE "id" = ${user.id}::uuid
            FOR UPDATE
          `;

          if (currentUser?.password_hash !== user.password_hash) {
            throw new GraphQLError('email or password is incorrect', {
              extensions: { code: 'UNAUTHENTICATED' },
            });
          }

          await tx.refresh_tokens.create({
            data: {
              id: randomUUID(),
              user_id: user.id,
              token_hash: hashRefreshToken(refreshToken),
              expires_at: expiresAt,
            },
          });
        },
        { isolationLevel: 'ReadCommitted' }
      );

      setRefreshTokenCookie(ctx.res, refreshToken, expiresAt);

      return { accessToken, user };
    },

    refreshAccessToken: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      try {
        const rawToken: unknown = ctx.req.cookies?.refresh_token;

        if (typeof rawToken !== 'string' || rawToken.length === 0) {
          throw new Error('Missing refresh token');
        }

        const tokenHash = hashRefreshToken(rawToken);
        const session = await ctx.prisma.$transaction(
          async (tx) => {
            const tokenOwner = await tx.refresh_tokens.findUnique({
              where: { token_hash: tokenHash },
              select: { user_id: true },
            });

            if (!tokenOwner) {
              return null;
            }

            await tx.$queryRaw`
              SELECT "id" FROM "users"
              WHERE "id" = ${tokenOwner.user_id}::uuid
              FOR UPDATE
            `;

            const storedToken = await tx.refresh_tokens.findUnique({
              where: { token_hash: tokenHash },
              include: { user: { include: { staff: true } } },
            });

            if (!storedToken) {
              return null;
            }

            const now = new Date();

            if (storedToken.revoked_at !== null) {
              await tx.refresh_tokens.updateMany({
                where: { user_id: storedToken.user_id, revoked_at: null },
                data: { revoked_at: now },
              });

              return null;
            }

            if (storedToken.expires_at.getTime() <= now.getTime() || !storedToken.user.staff) {
              return null;
            }

            const accessToken = generateStaffAccessToken({
              userId: storedToken.user.id,
              role: storedToken.user.staff.staffType,
            });
            const refreshToken = generateRefreshToken();
            const expiresAt = getRefreshTokenExpiry();

            await tx.refresh_tokens.update({
              where: { id: storedToken.id },
              data: { revoked_at: now },
            });
            await tx.refresh_tokens.create({
              data: {
                id: randomUUID(),
                user_id: storedToken.user_id,
                token_hash: hashRefreshToken(refreshToken),
                expires_at: expiresAt,
              },
            });

            return { accessToken, user: storedToken.user, refreshToken, expiresAt };
          },
          { isolationLevel: 'ReadCommitted' }
        );

        if (!session) {
          throw new Error('Invalid refresh token');
        }

        setRefreshTokenCookie(ctx.res, session.refreshToken, session.expiresAt);

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
          const tokenHash = hashRefreshToken(rawToken);

          await ctx.prisma.$transaction(
            async (tx) => {
              const tokenOwner = await tx.refresh_tokens.findUnique({
                where: { token_hash: tokenHash },
                select: { user_id: true },
              });

              if (!tokenOwner) {
                return;
              }

              await tx.$queryRaw`
                SELECT "id" FROM "users"
                WHERE "id" = ${tokenOwner.user_id}::uuid
                FOR UPDATE
              `;

              await tx.refresh_tokens.updateMany({
                where: { token_hash: tokenHash, revoked_at: null },
                data: { revoked_at: new Date() },
              });
            },
            { isolationLevel: 'ReadCommitted' }
          );
        }
      } finally {
        clearRefreshTokenCookie(ctx.res);
      }

      return true;
    },

    createStaffAccount: async (
      _parent: unknown,
      args: {
        firstName: string;
        lastName: string;
        email: string;
        phoneNumber: string;
        password: string;
        passwordConfirm: string;
        role: PrismaStaffType;
      },
      ctx: GraphQLContext
    ) => {
      requireRole(ctx.auth, [PrismaStaffType.ADMIN]);

      if (args.password !== args.passwordConfirm) {
        throw new GraphQLError('Passwords do not match', {
          extensions: { code: 'BAD_USER_INPUT', field: 'passwordConfirm' },
        });
      }

      const passwordHash = await hashPassword(args.password);

      try {
        return await ctx.prisma.user.create({
          data: {
            id: randomUUID(),
            first_name: args.firstName,
            last_name: args.lastName,
            email: args.email,
            phone_number: args.phoneNumber,
            password_hash: passwordHash,
            staff: { create: { staffType: args.role } },
          },
          include: { staff: true },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existingUser = await ctx.prisma.user.findUnique({
            where: { email: args.email },
            select: { id: true },
          });

          if (existingUser) {
            throw new GraphQLError('Email is already in use', {
              extensions: { code: 'BAD_USER_INPUT', field: 'email' },
            });
          }
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

      const passwordHash = await hashPassword(args.newPassword);

      await ctx.prisma.$transaction(
        async (tx) => {
          const updatedUser = await tx.user.updateMany({
            where: { id: args.userId },
            data: { password_hash: passwordHash },
          });

          if (updatedUser.count === 0) {
            throw new GraphQLError('User not found', {
              extensions: { code: 'BAD_USER_INPUT', field: 'userId' },
            });
          }

          await tx.refresh_tokens.updateMany({
            where: { user_id: args.userId, revoked_at: null },
            data: { revoked_at: new Date() },
          });
        },
        { isolationLevel: 'ReadCommitted' }
      );

      return true;
    },
  },
};
