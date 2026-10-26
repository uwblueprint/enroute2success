import type { Announcements } from '../../../generated/client';
import { announcementService } from '../services/announcementService';
import { GraphQLError } from 'graphql';
import type { GraphQLContext } from '../context';
import { requireRole } from '../../utils/auth';
import { StaffType as PrismaStaffType } from '../../../generated/client';

export const announcementResolvers = {
  Query: {
    // TODO(auth): requireRole 
    currentAnnouncements: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      return announcementService.getCurrentAnnouncements(ctx.prisma);
    },

    liveAndUpcomingAnnouncements: async (_parent: unknown, args: null, ctx: GraphQLContext) => {
      const caller = requireRole(ctx.auth, [
        PrismaStaffType.ADMIN,
      ]);
      const user = await announcementService.getLiveAndUpcomingAnnouncements(ctx.prisma);

      if (!user) {
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      return user;
    },

    pastAnnouncements: async (_parent: unknown, args: null, ctx: GraphQLContext) => {
      const caller = requireRole(ctx.auth, [
        PrismaStaffType.ADMIN,
      ]);
      const user = await announcementService.getPastAnnouncements(ctx.prisma);

      if (!user) {
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      return user;
    },
  },

  
  AnnouncementDTO: {
    start_date: (a: Announcements) => a.start_date.toISOString(),
    end_date: (a: Announcements) => a.end_date.toISOString(),
    deleted_at: (a: Announcements) => a.deleted_at?.toISOString() ?? null,
    createdAt: (a: Announcements) => a.created_at.toISOString(),
    updatedAt: (a: Announcements) => a.updated_at.toISOString(),
  },
};
