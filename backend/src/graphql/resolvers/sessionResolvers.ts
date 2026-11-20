import { GraphQLError } from 'graphql';
import { Role } from '../../../generated/client';
import type { session, session_status } from '../../../generated/client';
import type { GraphQLContext } from '../context';
import { allRoles, requireRole } from '../../utils/auth';
import { getSessionById, listSessionsForMonth } from '../../services/sessionService';

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

type SessionsArgs = {
  month?: number | null;
  year?: number | null;
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
      const { month, year } = args;
      const sessionStatuses: session_status[] | null | undefined =
        caller.role === Role.STUDENT ? ['scheduled', 'cancelled'] : args.sessionStatuses;

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
          extensions: { code: 'BAD_USER_INPUT', field: 'month' },
        });
      }
      if (hasYear && (year! < MIN_YEAR || year! > MAX_YEAR)) {
        throw new GraphQLError(`year must be between ${MIN_YEAR} and ${MAX_YEAR}`, {
          extensions: { code: 'BAD_USER_INPUT', field: 'year' },
        });
      }

      const target = hasMonth ? { month: month!, year: year! } : null;

      return listSessionsForMonth(ctx.prisma, target, sessionStatuses);
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
