import { GraphQLError } from 'graphql';
import { Role } from '../../../generated/client';
import type { Feedback } from '../../../generated/client';
import type { GraphQLContext } from '../context';
import {
  getMySessionFeedback,
  getStudentSessionFeedback,
  listSessionFeedback,
  listStudentFeedback,
  SessionNotFoundError,
} from '../../services/feedbackService';
import { requireRole } from '../../utils/auth';

type SessionFeedbackArgs = {
  sessionId: string;
};

type StudentSessionFeedbackArgs = SessionFeedbackArgs & {
  studentId: number;
};

const staffRoles = [Role.ADMIN, Role.COACH, Role.VOLUNTEER] as const;

function validateUuid(value: string, field: string): void {
  const uuid = value.startsWith('{') && value.endsWith('}') ? value.slice(1, -1) : value;

  if (!/^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/i.test(uuid)) {
    throw new GraphQLError(`${field} must be a valid UUID`, {
      extensions: { code: 'BAD_USER_INPUT', field },
    });
  }
}

export const feedbackResolvers = {
  Query: {
    sessionFeedback: async (
      _parent: unknown,
      args: SessionFeedbackArgs,
      ctx: GraphQLContext
    ): Promise<Feedback[]> => {
      requireRole(ctx.auth, staffRoles);
      validateUuid(args.sessionId, 'sessionId');

      try {
        return await listSessionFeedback(ctx.prisma, args.sessionId);
      } catch (error) {
        if (error instanceof SessionNotFoundError) {
          throw new GraphQLError('Session not found', {
            extensions: { code: 'NOT_FOUND', id: args.sessionId },
          });
        }

        throw error;
      }
    },

    studentSessionFeedback: async (
      _parent: unknown,
      args: StudentSessionFeedbackArgs,
      ctx: GraphQLContext
    ): Promise<Feedback | null> => {
      requireRole(ctx.auth, staffRoles);
      validateUuid(args.sessionId, 'sessionId');

      return getStudentSessionFeedback(ctx.prisma, args.studentId, args.sessionId);
    },

    myFeedback: async (
      _parent: unknown,
      _args: unknown,
      ctx: GraphQLContext
    ): Promise<Feedback[]> => {
      const caller = requireRole(ctx.auth, [Role.STUDENT]);

      if (caller.activeStudentId === null) {
        throw new GraphQLError('No active student selected', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      return listStudentFeedback(ctx.prisma, caller.activeStudentId);
    },

    mySessionFeedback: async (
      _parent: unknown,
      args: SessionFeedbackArgs,
      ctx: GraphQLContext
    ): Promise<Feedback | null> => {
      const caller = requireRole(ctx.auth, [Role.STUDENT]);

      if (caller.activeStudentId === null) {
        throw new GraphQLError('No active student selected', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      validateUuid(args.sessionId, 'sessionId');

      try {
        return await getMySessionFeedback(ctx.prisma, caller.activeStudentId, args.sessionId);
      } catch (error) {
        if (error instanceof SessionNotFoundError) {
          throw new GraphQLError('Session not found', {
            extensions: { code: 'NOT_FOUND', id: args.sessionId },
          });
        }

        throw error;
      }
    },
  },

  Feedback: {
    studentId: (feedback: Feedback) => feedback.receiver,
    giverId: (feedback: Feedback) => feedback.giver,
    updatedById: (feedback: Feedback) => feedback.updated_by,
    sessionId: (feedback: Feedback) => feedback.session_id,
    createdAt: (feedback: Feedback) => feedback.created_at.toISOString(),
    updatedAt: (feedback: Feedback) => feedback.updated_at.toISOString(),
  },
};
