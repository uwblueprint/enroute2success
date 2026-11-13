import { makeExecutableSchema } from '@graphql-tools/schema';
import { UUIDResolver } from 'graphql-scalars';
import type { GraphQLContext } from './context';
import { announcementResolvers } from './resolvers/announcementResolvers';
import { feedbackResolvers } from './resolvers/feedbackResolvers';
import { sessionPointsResolvers } from './resolvers/sessionPointsResolvers';
import { sessionResolvers } from './resolvers/sessionResolvers';
import { userResolvers } from './resolvers/userResolvers';
import { announcementTypeDefs } from './types/announcementTypes';
import { feedbackTypeDefs } from './types/feedbackTypes';
import { sessionPointsTypeDefs } from './types/sessionPointsTypes';
import { sessionTypeDefs } from './types/sessionTypes';
import { userTypeDefs } from './types/userTypes';

const baseTypeDefs = `#graphql
  scalar UUID

  type HealthStatus {
    ok: Boolean!
    databaseConnected: Boolean!
    timestamp: String!
  }

  type Query {
    health: HealthStatus!
  }

  type Mutation
`;

const baseResolvers = {
  UUID: UUIDResolver,

  Query: {
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
  },
};

export const schema = makeExecutableSchema<GraphQLContext>({
  typeDefs: [
    baseTypeDefs,
    userTypeDefs,
    sessionTypeDefs,
    announcementTypeDefs,
    feedbackTypeDefs,
    sessionPointsTypeDefs,
  ],
  resolvers: [
    baseResolvers,
    userResolvers,
    sessionResolvers,
    announcementResolvers,
    feedbackResolvers,
    sessionPointsResolvers,
  ],
});
