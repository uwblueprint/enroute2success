import { GraphQLError } from 'graphql';
import { Role } from '../../../generated/client';
import type { Feedback } from '../../../generated/client';
import type { GraphQLContext } from '../context';
import {
  createFeedback,
  FeedbackAlreadyExistsError,
  FeedbackEditWindowError,
  FeedbackNotFoundError,
  getMySessionFeedback,
  getStudentSessionFeedback,
  listSessionFeedback,
  listStudentFeedback,
  SessionNotFoundError,
  StudentNotFoundError,
  updateFeedback,
} from '../../services/feedbackService';
import { requireRole, staffRoles } from '../../utils/auth';
import { validatePositiveInt, validateText } from '../../utils/validation';

const FEEDBACK_TEXT_MAX_LENGTH = 5000;

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

type UpdateFeedbackArgs = {
  id: string;
  input: {
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
      const studentId = validatePositiveInt(args.studentId, 'studentId');

      return getStudentSessionFeedback(ctx.prisma, studentId, args.sessionId);
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
      const { sessionId } = args.input;
      const studentId = validatePositiveInt(args.input.studentId, 'studentId');
      const text = validateText(args.input.text, 'text', FEEDBACK_TEXT_MAX_LENGTH);

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

    updateFeedback: async (
      _parent: unknown,
      args: UpdateFeedbackArgs,
      ctx: GraphQLContext
    ): Promise<Feedback> => {
      const caller = requireRole(ctx.auth, staffRoles);
      const text = validateText(args.input.text, 'text', FEEDBACK_TEXT_MAX_LENGTH);

      try {
        return await updateFeedback(
          ctx.prisma,
          { id: args.id, text, updated_by: caller.userId },
          caller.role
        );
      } catch (error) {
        if (error instanceof FeedbackNotFoundError) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'NOT_FOUND', id: args.id },
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
