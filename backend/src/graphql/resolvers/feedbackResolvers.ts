import { GraphQLError } from 'graphql';
import { Role } from '../../../generated/client';
import type { Feedback } from '../../../generated/client';
import type { GraphQLContext } from '../context';
import {
  createFeedback,
  FeedbackAlreadyExistsError,
  FeedbackEditWindowError,
  getMySessionFeedback,
  getStudentSessionFeedback,
  listSessionFeedback,
  listStudentFeedback,
  SessionNotFoundError,
  StudentNotFoundError,
} from '../../services/feedbackService';
import { requireRole, staffRoles } from '../../utils/auth';

type SessionFeedbackArgs = {
  sessionId: string;
};

type StudentSessionFeedbackArgs = SessionFeedbackArgs & {
  studentId: number;
};

type CreateFeedbackArgs = {
  input: {
    studentId: number;
    sessionId: string;
    text: string;
  };
};

export const feedbackResolvers = {
  Query: {
    sessionFeedback: async (
      _parent: unknown,
      args: SessionFeedbackArgs,
      ctx: GraphQLContext
    ): Promise<Feedback[]> => {
      requireRole(ctx.auth, staffRoles);

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

  Mutation: {
    createFeedback: async (
      _parent: unknown,
      args: CreateFeedbackArgs,
      ctx: GraphQLContext
    ): Promise<Feedback> => {
      const caller = requireRole(ctx.auth, staffRoles);
      const { studentId, sessionId } = args.input;
      const text = args.input.text.trim();

      if (text.length === 0) {
        throw new GraphQLError('Feedback text must not be empty', {
          extensions: { code: 'BAD_USER_INPUT', field: 'text' },
        });
      }

      try {
        return await createFeedback(
          ctx.prisma,
          { receiver: studentId, session_id: sessionId, text, giver: caller.userId },
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

        if (error instanceof FeedbackAlreadyExistsError) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }

        if (error instanceof FeedbackEditWindowError) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'FORBIDDEN' },
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
