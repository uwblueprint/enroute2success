import { GraphQLError } from 'graphql';
import { Role } from '../../../generated/client';
import type { Feedback } from '../../../generated/client';
import type { GraphQLContext } from '../context';
import {
  getStudentSessionFeedback,
  getVisibleStudentSessionFeedback,
  listSessionFeedback,
  listStudentFeedback,
  listVisibleStudentFeedback,
  SessionNotFoundError,
} from '../../services/feedbackService';
import { managesStudent } from '../../services/userService';
import { allRoles, requireRole, staffRoles } from '../../utils/auth';
import { validatePositiveInt } from '../../utils/validation';

type SessionFeedbackArgs = {
  sessionId: string;
};

type StudentFeedbackArgs = {
  studentId: number;
};

type StudentSessionFeedbackArgs = SessionFeedbackArgs & StudentFeedbackArgs;

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
