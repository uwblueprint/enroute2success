import { randomUUID } from 'node:crypto';
import { GraphQLError } from 'graphql';
import { UUIDResolver } from 'graphql-scalars';
import { StaffType as PrismaStaffType } from '../../generated/client';
import type { User, StaffUsers } from '../../generated/client';
import type { GraphQLContext } from '../context';
import { generateStaffAccessToken } from '../accessTokens';
import { requireRole } from '../auth';
import { hashPassword, verifyPassword } from '../passwords';
import { generateRefreshToken, getRefreshTokenExpiry, hashRefreshToken } from '../refreshTokens';
import { clearRefreshTokenCookie, setRefreshTokenCookie } from '../refreshTokenCookies';

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
    me: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      const caller = requireRole(ctx.auth, [
        PrismaStaffType.ADMIN,
        PrismaStaffType.COACHES,
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

              // Use the same user lock as refresh before revoking this token.
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
  },
};
