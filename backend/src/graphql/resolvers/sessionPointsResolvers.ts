import { GraphQLError } from 'graphql';
import { Role } from '../../../generated/client';
import type { SessionPoints } from '../../../generated/client';
import {
  createSessionPoints,
  getMySessionPoints,
  getStudentSessionPoints,
  listSessionPoints,
  listStudentPoints,
  SessionNotFoundError,
  SessionPointsAlreadyExistsError,
  SessionPointsEditWindowError,
  StudentNotFoundError,
  sumSessionPoints,
} from '../../services/sessionPointsService';
import type { SessionPointsCategories } from '../../services/sessionPointsService';
import { requireRole, staffRoles } from '../../utils/auth';
import type { GraphQLContext } from '../context';

type SessionPointsArgs = {
  sessionId: string;
};

type StudentSessionPointsArgs = SessionPointsArgs & {
  studentId: number;
};

type CreateSessionPointsArgs = {
  input: StudentSessionPointsArgs & {
    categories: SessionPointsCategories;
  };
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateSessionId(sessionId: string): void {
  if (!UUID_PATTERN.test(sessionId)) {
    throw new GraphQLError('sessionId must be a valid UUID', {
      extensions: { code: 'BAD_USER_INPUT', field: 'sessionId' },
    });
  }
}

export const sessionPointsResolvers = {
  Query: {
    sessionPointsForSession: async (
      _parent: unknown,
      args: SessionPointsArgs,
      ctx: GraphQLContext
    ): Promise<SessionPoints[]> => {
      requireRole(ctx.auth, staffRoles);
      validateSessionId(args.sessionId);

      try {
        return await listSessionPoints(ctx.prisma, args.sessionId);
      } catch (error) {
        if (error instanceof SessionNotFoundError) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'NOT_FOUND', id: args.sessionId },
          });
        }

        throw error;
      }
    },

    studentSessionPoints: async (
      _parent: unknown,
      args: StudentSessionPointsArgs,
      ctx: GraphQLContext
    ): Promise<SessionPoints | null> => {
      requireRole(ctx.auth, staffRoles);
      validateSessionId(args.sessionId);

      return getStudentSessionPoints(ctx.prisma, args.studentId, args.sessionId);
    },

    myPoints: async (
      _parent: unknown,
      _args: unknown,
      ctx: GraphQLContext
    ): Promise<SessionPoints[]> => {
      const caller = requireRole(ctx.auth, [Role.STUDENT]);

      if (caller.activeStudentId === null) {
        throw new GraphQLError('No active student selected', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      return listStudentPoints(ctx.prisma, caller.activeStudentId);
    },

    mySessionPoints: async (
      _parent: unknown,
      args: SessionPointsArgs,
      ctx: GraphQLContext
    ): Promise<SessionPoints | null> => {
      const caller = requireRole(ctx.auth, [Role.STUDENT]);

      if (caller.activeStudentId === null) {
        throw new GraphQLError('No active student selected', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      validateSessionId(args.sessionId);

      try {
        return await getMySessionPoints(ctx.prisma, caller.activeStudentId, args.sessionId);
      } catch (error) {
        if (error instanceof SessionNotFoundError) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'NOT_FOUND', id: args.sessionId },
          });
        }

        throw error;
      }
    },
  },

  Mutation: {
    createSessionPoints: async (
      _parent: unknown,
      args: CreateSessionPointsArgs,
      ctx: GraphQLContext
    ): Promise<SessionPoints> => {
      const caller = requireRole(ctx.auth, staffRoles);
      const { studentId, sessionId, categories } = args.input;
      validateSessionId(sessionId);

      for (const [field, score] of Object.entries(categories)) {
        if (!Number.isInteger(score) || score < 0 || score > 10) {
          throw new GraphQLError(`${field} must be an integer from 0 to 10`, {
            extensions: { code: 'BAD_USER_INPUT', field },
          });
        }
      }

      try {
        return await createSessionPoints(
          ctx.prisma,
          { ...categories, membershipId: studentId, sessionId, givenBy: caller.userId },
          caller.role
        );
      } catch (error) {
        if (error instanceof SessionNotFoundError) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'NOT_FOUND', id: sessionId },
          });
        }

        if (error instanceof StudentNotFoundError) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'NOT_FOUND', id: studentId },
          });
        }

        if (error instanceof SessionPointsAlreadyExistsError) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }

        if (error instanceof SessionPointsEditWindowError) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'FORBIDDEN' },
          });
        }

        throw error;
      }
    },
  },

  SessionPoints: {
    studentId: (points: SessionPoints) => points.membership_id,
    sessionId: (points: SessionPoints) => points.session_id,
    givenById: (points: SessionPoints) => points.given_by,
    updatedById: (points: SessionPoints) => points.updated_by,
    extraRecognition: (points: SessionPoints) => points.extra_recognition,
    attendedWorkshop: (points: SessionPoints) => points.attended_workshop,
    wonTournament: (points: SessionPoints) => points.won_tournament,
    total: sumSessionPoints,
    createdAt: (points: SessionPoints) => points.created_at.toISOString(),
    updatedAt: (points: SessionPoints) => points.updated_at.toISOString(),
  },
};
