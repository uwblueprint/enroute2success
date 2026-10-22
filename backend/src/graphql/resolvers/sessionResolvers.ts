import { GraphQLError } from 'graphql';
import type { session, session_status } from '../../../generated/client';
import type { GraphQLContext } from '../context';
import { getSessionById, listSessionsForMonth } from '../../services/sessionService';

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
    // TODO(auth): There is no auth/roles layer yet, so every status — including
    // DRAFT and CANCELLED — is readable by anyone. Once auth lands, restrict
    // DRAFT (and likely CANCELLED) to privileged roles and default anonymous
    // callers to SCHEDULED only.
    sessions: async (_parent: unknown, args: SessionsArgs, ctx: GraphQLContext) => {
      const { month, year, sessionStatuses } = args;

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

      const target = hasMonth ? { month: month!, year: year! } : null;

      return listSessionsForMonth(ctx.prisma, target, sessionStatuses);
    },

    // TODO(auth): Same lockdown as `sessions` — once auth exists, a nonexistent
    // ID and an unauthorized-status ID should be indistinguishable (both
    // NOT_FOUND) so DRAFT/CANCELLED sessions can't be probed by id.
    session: async (_parent: unknown, args: SessionArgs, ctx: GraphQLContext): Promise<session> => {
      const found = await getSessionById(ctx.prisma, args.id);
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
};
