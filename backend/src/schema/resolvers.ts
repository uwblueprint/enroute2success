import type { GraphQLContext } from "../context";
import type { session, session_status } from "../../generated/client";
//import { GraphQLError } from "graphql";

type SessionsArgs = {
  month?: number | null;
  year?: number | null;
  sessionStatuses?: session_status[] | null;
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

    sessions: async (
      _parent: unknown,
      args: SessionsArgs,
      ctx: GraphQLContext
    ) => {
      const { month, year, sessionStatuses } = args;

      if (month != null && (month < 1 || month > 12)) {
        throw new Error("month must be between 1 and 12");
      }

      // Date range: month+year -> that month; year only -> that year;
      // month only -> that mcreaonth of the current year; neither -> no date filter
      let startRange: { gte: Date; lt: Date } | undefined;
      if (month != null || year != null) {
        const y = year ?? new Date().getUTCFullYear();
        startRange = {
          gte: new Date(Date.UTC(y, (month ?? 1) - 1, 1)),
          lt:
            month != null
              ? new Date(Date.UTC(y, month, 1)) // month 12 rolls to next Jan
              : new Date(Date.UTC(y + 1, 0, 1)),
        };
      }

      return ctx.prisma.session.findMany({
        where: {
          ...(startRange && { start_datetime: startRange }),
          ...(sessionStatuses?.length && { status: { in: sessionStatuses } }),
        },
        orderBy: { start_datetime: "asc" },
      });
    },
  },

  Session: {
    startDatetime: (s: session) => s.start_datetime.toISOString(),
    endDatetime: (s: session) => s.end_datetime.toISOString(),
    maxAttendees: (s: session) => s.max_attendees,
  },
};
