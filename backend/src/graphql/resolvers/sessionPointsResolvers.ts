import { GraphQLError } from 'graphql';
import type { SessionPoints } from '../../../generated/client';
import {
  getStudentSessionPoints,
  listSessionPoints,
  SessionNotFoundError,
  sumSessionPoints,
} from '../../services/sessionPointsService';
import { requireRole, staffRoles } from '../../utils/auth';
import type { GraphQLContext } from '../context';

type SessionPointsArgs = {
  sessionId: string;
};

type StudentSessionPointsArgs = SessionPointsArgs & {
  studentId: number;
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
