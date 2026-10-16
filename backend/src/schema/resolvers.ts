import { UUIDResolver } from 'graphql-scalars';
import { StaffType as PrismaStaffType } from '../../generated/client';
import type { User, StaffUsers } from '../../generated/client';
import type { GraphQLContext } from '../context';

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
};
