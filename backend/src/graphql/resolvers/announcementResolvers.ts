import { GraphQLError } from 'graphql';
import { Role as PrismaRole } from '../../../generated/client';
import type { GraphQLContext } from '../context';
import {
  AnnouncementInvalidInputError,
  AnnouncementNotFoundError,
  AnnouncementNotModifiableError,
  createAnnouncement,
  deleteAnnouncement,
  listCurrentAnnouncements,
  listLiveAndUpcomingAnnouncements,
  listPastAnnouncements,
  updateAnnouncement,
} from '../../services/announcementService';
import type { AnnouncementDTO } from '../../services/announcementService';
import { requireRole } from '../../utils/auth';
import { isValidLocalDate } from '../../utils/datetime';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CreateAnnouncementArgs = {
  input: { message: string; start_date: string; end_date?: string | null };
};

type UpdateAnnouncementArgs = {
  id: string;
  input: { message?: string | null; start_date?: string | null; end_date?: string | null };
};

function badUserInput(message: string, field: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT', field } });
}

function validateId(id: string): void {
  if (!UUID_PATTERN.test(id)) {
    throw badUserInput('id must be a valid UUID', 'id');
  }
}

function validateMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    throw badUserInput('message cannot be empty', 'message');
  }
  return trimmed;
}

function validateDay(value: string, field: string): string {
  if (!isValidLocalDate(value)) {
    throw badUserInput(`${field} must be a valid date in YYYY-MM-DD format`, field);
  }
  return value;
}

// Translate the service's typed errors into GraphQL errors with stable codes.
// Anything unrecognized is rethrown and surfaces as INTERNAL_SERVER_ERROR.
function toGraphQLError(error: unknown): unknown {
  if (error instanceof AnnouncementInvalidInputError) {
    return new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  if (error instanceof AnnouncementNotFoundError) {
    return new GraphQLError(error.message, { extensions: { code: 'NOT_FOUND' } });
  }
  if (error instanceof AnnouncementNotModifiableError) {
    return new GraphQLError(error.message, { extensions: { code: 'CONFLICT' } });
  }
  return error;
}

export const announcementResolvers = {
  Query: {
    // TODO(auth): This resolver is intentionally NOT guarded with requireRole,
    // because requireRole doesn't work for students/parents yet, so right now
    // *anyone* (even an unauthenticated caller) can read it. Once Justin
    // finishes the student/parent login flow, restrict it to logged-in users.
    currentAnnouncements: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      return listCurrentAnnouncements(ctx.prisma);
    },

    liveAndUpcomingAnnouncements: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireRole(ctx.auth, [PrismaRole.ADMIN]);
      return listLiveAndUpcomingAnnouncements(ctx.prisma);
    },

    pastAnnouncements: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireRole(ctx.auth, [PrismaRole.ADMIN]);
      return listPastAnnouncements(ctx.prisma);
    },
  },

  Mutation: {
    createAnnouncement: async (
      _parent: unknown,
      args: CreateAnnouncementArgs,
      ctx: GraphQLContext
    ) => {
      const caller = requireRole(ctx.auth, [PrismaRole.ADMIN]);

      const message = validateMessage(args.input.message);
      const startDate = validateDay(args.input.start_date, 'start_date');
      const endDate =
        args.input.end_date != null ? validateDay(args.input.end_date, 'end_date') : null;

      try {
        return await createAnnouncement(ctx.prisma, caller.userId, {
          message,
          start_date: startDate,
          end_date: endDate,
        });
      } catch (error) {
        throw toGraphQLError(error);
      }
    },

    updateAnnouncement: async (
      _parent: unknown,
      args: UpdateAnnouncementArgs,
      ctx: GraphQLContext
    ) => {
      requireRole(ctx.auth, [PrismaRole.ADMIN]);

      validateId(args.id);

      // In GraphQL an input field can be omitted OR sent as an explicit null.
      // The columns can't be cleared, so both mean "leave this field alone".
      const { message, start_date, end_date } = args.input;
      const changes: { message?: string; start_date?: string; end_date?: string } = {};
      if (message != null) {
        changes.message = validateMessage(message);
      }
      if (start_date != null) {
        changes.start_date = validateDay(start_date, 'start_date');
      }
      if (end_date != null) {
        changes.end_date = validateDay(end_date, 'end_date');
      }
      if (Object.keys(changes).length === 0) {
        throw badUserInput('Provide at least one field to update', 'input');
      }

      try {
        return await updateAnnouncement(ctx.prisma, args.id, changes);
      } catch (error) {
        throw toGraphQLError(error);
      }
    },

    deleteAnnouncement: async (_parent: unknown, args: { id: string }, ctx: GraphQLContext) => {
      requireRole(ctx.auth, [PrismaRole.ADMIN]);

      validateId(args.id);

      try {
        return await deleteAnnouncement(ctx.prisma, args.id);
      } catch (error) {
        throw toGraphQLError(error);
      }
    },
  },

  // Field resolvers: the schema declares these dates as String, but the service
  // returns Date objects. These turn each Date into an ISO 8601 string.
  AnnouncementDTO: {
    start_date: (a: AnnouncementDTO) => a.start_date.toISOString(),
    end_date: (a: AnnouncementDTO) => a.end_date?.toISOString() ?? null,
    deleted_at: (a: AnnouncementDTO) => a.deleted_at?.toISOString() ?? null,
    createdAt: (a: AnnouncementDTO) => a.createdAt.toISOString(),
    updatedAt: (a: AnnouncementDTO) => a.updatedAt.toISOString(),
  },
};
