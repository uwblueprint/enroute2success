import { GraphQLError } from 'graphql';
import { Role } from '../../../generated/client';
import type { session, session_status } from '../../../generated/client';
import type { GraphQLContext } from '../context';
import { allRoles, requireRole } from '../../utils/auth';
import { getSessionById, listSessionsInRange } from '../../services/sessionService';
import { validateDateRange } from '../../utils/validation';

type SessionsArgs = {
  from: string;
  to: string;
  sessionStatuses?: session_status[] | null;
};

type SessionArgs = {
  id: string;
};

export const sessionResolvers = {
  Query: {
    // Requires login. Staff can filter by any status; students/parents always
    // get SCHEDULED and CANCELLED (any sessionStatuses they pass is ignored).
    sessions: async (_parent: unknown, args: SessionsArgs, ctx: GraphQLContext) => {
      const caller = requireRole(ctx.auth, allRoles);
      const sessionStatuses: session_status[] | null | undefined =
        caller.role === Role.STUDENT ? ['scheduled', 'cancelled'] : args.sessionStatuses;
      const { from, to } = validateDateRange(args.from, args.to);

      return listSessionsInRange(ctx.prisma, from, to, sessionStatuses);
    },

    // Requires login. For students/parents, DRAFT sessions are
    // indistinguishable from nonexistent ones (both NOT_FOUND).
    session: async (_parent: unknown, args: SessionArgs, ctx: GraphQLContext): Promise<session> => {
      const caller = requireRole(ctx.auth, allRoles);
      const found = await getSessionById(ctx.prisma, args.id);
      if (!found || (caller.role === Role.STUDENT && found.status === 'draft')) {
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
};
