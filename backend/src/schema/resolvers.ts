import { randomUUID } from 'node:crypto';
import { GraphQLError } from 'graphql';
import { UUIDResolver } from 'graphql-scalars';
import { StaffType as PrismaStaffType } from '../../generated/client';
import type { User, StaffUsers } from '../../generated/client';
import type { GraphQLContext } from '../context';
import { generateStaffAccessToken } from '../accessTokens';
import { hashPassword, verifyPassword } from '../passwords';
import { generateRefreshToken, getRefreshTokenExpiry, hashRefreshToken } from '../refreshTokens';
import { setRefreshTokenCookie } from '../refreshTokenCookies';

// A database user with their staff relation loaded.
// The staff relation can be null.
type UserWithStaff = User & {
  staff: StaffUsers | null;
};

export const resolvers = {
  UUID: UUIDResolver,

  StaffType: {
    COACH: PrismaStaffType.COACHES,
    VOLUNTEER: PrismaStaffType.VOLUNTEER,
    ADMIN: PrismaStaffType.ADMIN,
  },

  User: {
    firstName: (user: UserWithStaff) => user.first_name,

    lastName: (user: UserWithStaff) => user.last_name,

    role: (user: UserWithStaff) => user.staff?.staffType ?? null,
  },

  Query: {
    health: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      let databaseConnected = false;

      try {
        await ctx.prisma.$queryRaw`SELECT 1`;
        databaseConnected = true;
      } catch (err) {
        console.error('[health] database check failed:', err);
      }

      return {
        ok: true,
        databaseConnected,
        timestamp: new Date().toISOString(),
      };
    },
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

      await ctx.prisma.refresh_tokens.create({
        data: {
          id: randomUUID(),
          user_id: user.id,
          token_hash: hashRefreshToken(refreshToken),
          expires_at: expiresAt,
        },
      });

      setRefreshTokenCookie(ctx.res, refreshToken, expiresAt);

      return { accessToken, user };
    },
  },
};
