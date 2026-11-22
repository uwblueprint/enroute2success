import { GraphQLError } from 'graphql';
import { Role } from '../../../generated/client';
import type { Feedback } from '../../../generated/client';
import type { GraphQLContext } from '../context';
import {
  createFeedback,
  FeedbackAlreadyExistsError,
  FeedbackEditWindowError,
  FeedbackNotFoundError,
  getVisibleStudentSessionFeedback,
  getStudentSessionFeedback,
  listSessionFeedback,
  listVisibleStudentFeedback,
  listStudentFeedback,
  sendFeedback,
  SessionNotFoundError,
  StudentNotFoundError,
  updateFeedback,
} from '../../services/feedbackService';
import { managesStudent } from '../../services/userService';
import { allRoles, requireRole, staffRoles } from '../../utils/auth';
import { validatePositiveInt, validateText } from '../../utils/validation';

const FEEDBACK_TEXT_MAX_LENGTH = 5000;

type SessionFeedbackArgs = {
  sessionId: string;
};

type StudentFeedbackArgs = {
  studentId: number;
};

type StudentSessionFeedbackArgs = SessionFeedbackArgs & StudentFeedbackArgs;

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
      const caller = requireRole(ctx.auth, allRoles);
      const studentId = validatePositiveInt(args.studentId, 'studentId');

      if (caller.role !== Role.STUDENT) {
        return getStudentSessionFeedback(ctx.prisma, studentId, args.sessionId);
      }

      if (!(await managesStudent(ctx.prisma, caller.userId, studentId))) {
        throw new GraphQLError('You do not manage this student', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      try {
        return await getVisibleStudentSessionFeedback(ctx.prisma, studentId, args.sessionId);
      } catch (error) {
        if (error instanceof SessionNotFoundError) {
          throw new GraphQLError('Session not found', {
            extensions: { code: 'NOT_FOUND', id: args.sessionId },
          });
        }

        throw error;
      }
    },

    studentFeedback: async (
      _parent: unknown,
      args: StudentFeedbackArgs,
      ctx: GraphQLContext
    ): Promise<Feedback[]> => {
      const caller = requireRole(ctx.auth, allRoles);
      const studentId = validatePositiveInt(args.studentId, 'studentId');

      if (caller.role !== Role.STUDENT) {
        return listStudentFeedback(ctx.prisma, studentId);
      }

      if (!(await managesStudent(ctx.prisma, caller.userId, studentId))) {
        throw new GraphQLError('You do not manage this student', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      return listVisibleStudentFeedback(ctx.prisma, studentId);
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

    sendFeedback: async (
      _parent: unknown,
      args: { id: string },
      ctx: GraphQLContext
    ): Promise<Feedback> => {
      const caller = requireRole(ctx.auth, staffRoles);

      try {
        return await sendFeedback(ctx.prisma, args.id, caller.role);
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
    sentAt: (feedback: Feedback) => feedback.sent_at?.toISOString() ?? null,
    studentId: (feedback: Feedback) => feedback.receiver,
    giverId: (feedback: Feedback) => feedback.giver,
    updatedById: (feedback: Feedback) => feedback.updated_by,
    sessionId: (feedback: Feedback) => feedback.session_id,
    createdAt: (feedback: Feedback) => feedback.created_at.toISOString(),
    updatedAt: (feedback: Feedback) => feedback.updated_at.toISOString(),
  },
};
