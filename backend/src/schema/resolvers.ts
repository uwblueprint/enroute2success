import type { GraphQLContext } from "../context";
import type { session, session_status } from "../../generated/client";
import { GraphQLError } from "graphql";
import { currentLocalMonthYear, monthRangeUtc } from "../datetime";

type SessionsArgs = {
  month?: number | null;
  year?: number | null;
  sessionStatuses?: session_status[] | null;
};

type SessionArgs = {
  id: string;
};

export const resolvers = {
  Query: {
    health: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      let databaseConnected = false;
      try {
        await ctx.prisma.$queryRaw`SELECT 1`;
        databaseConnected = true;
      } catch (err) {
        //console.error("[health] database check failed:", err);
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
    sessions: async (
      _parent: unknown,
      args: SessionsArgs,
      ctx: GraphQLContext
    ) => {
      const { month, year, sessionStatuses } = args;

      // Validation: month and year must be provided together or not at all.
      // Supplying only one is ambiguous for a calendar month view.
      const hasMonth = month != null;
      const hasYear = year != null;
      if (hasMonth !== hasYear) {
        throw new GraphQLError(
          "month and year must be provided together (or omit both for the current month)",
          { extensions: { code: "BAD_USER_INPUT" } }
        );
      }
      if (hasMonth && (month! < 1 || month! > 12)) {
        throw new GraphQLError("month must be between 1 and 12", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }

      // Resolve the target local month. No params -> current local month.
      const target = hasMonth
        ? { month: month!, year: year! }
        : currentLocalMonthYear();

      // Compute UTC boundaries from the ORG's local timezone so sessions near
      // midnight land in the correct local month.
      const range = monthRangeUtc(target.year, target.month);

      return ctx.prisma.session.findMany({
        where: {
          start_datetime: { gte: range.gte, lt: range.lt },
          // An empty list or null means "all statuses".
          ...(sessionStatuses?.length && { status: { in: sessionStatuses } }),
        },
        orderBy: { start_datetime: "asc" },
      });
    },

    // TODO(auth): Same lockdown as `sessions` — once auth exists, a nonexistent
    // ID and an unauthorized-status ID should be indistinguishable (both
    // NOT_FOUND) so DRAFT/CANCELLED sessions can't be probed by id.
    session: async (
      _parent: unknown,
      args: SessionArgs,
      ctx: GraphQLContext
    ): Promise<session> => {
      const found = await ctx.prisma.session.findUnique({
        where: { id: args.id },
      });
      if (!found) {
        throw new GraphQLError("Session not found", {
          extensions: { code: "NOT_FOUND", id: args.id },
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
