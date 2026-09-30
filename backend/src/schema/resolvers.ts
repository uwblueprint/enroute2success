import type { GraphQLContext } from '../context';

export const resolvers = {
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
