import { GraphQLError } from 'graphql';
import { SessionNotFoundError, StudentNotFoundError } from '../../services/sessionPointsService';
import type { SessionPointsCategories } from '../../services/sessionPointsService';
import {
  saveSessionReport,
  SessionReportEditWindowError,
  SessionReportNotFoundError,
  sendSessionReport,
} from '../../services/sessionReportService';
import type { SessionReport } from '../../services/sessionReportService';
import { requireRole, staffRoles } from '../../utils/auth';
import { validateOptionalText, validatePositiveInt } from '../../utils/validation';
import type { GraphQLContext } from '../context';

const FEEDBACK_TEXT_MAX_LENGTH = 5000;

type SaveSessionReportArgs = {
  input: {
    sessionId: string;
    studentId: number;
    text: string;
    points: SessionPointsCategories;
  };
};

type SendSessionReportArgs = {
  sessionId: string;
  studentId: number;
};

function validatePoints(points: SessionPointsCategories): void {
  for (const [field, score] of Object.entries(points)) {
    if (!Number.isInteger(score) || score < 0 || score > 1) {
      throw new GraphQLError(`${field} must be an integer from 0 to 1`, {
        extensions: { code: 'BAD_USER_INPUT', field },
      });
    }
  }
}

function toReportError(error: unknown, sessionId: string, studentId: number): unknown {
  if (error instanceof SessionNotFoundError) {
    return new GraphQLError(error.message, { extensions: { code: 'NOT_FOUND', id: sessionId } });
  }

  if (error instanceof StudentNotFoundError) {
    return new GraphQLError(error.message, { extensions: { code: 'NOT_FOUND', id: studentId } });
  }

  if (error instanceof SessionReportNotFoundError) {
    return new GraphQLError(error.message, { extensions: { code: 'NOT_FOUND' } });
  }

  if (error instanceof SessionReportEditWindowError) {
    return new GraphQLError(error.message, { extensions: { code: 'FORBIDDEN' } });
  }

  return error;
}

export const sessionReportResolvers = {
  Mutation: {
    saveSessionReport: async (
      _parent: unknown,
      args: SaveSessionReportArgs,
      ctx: GraphQLContext
    ): Promise<SessionReport> => {
      const caller = requireRole(ctx.auth, staffRoles);
      const { sessionId, points } = args.input;
      const studentId = validatePositiveInt(args.input.studentId, 'studentId');
      const text = validateOptionalText(args.input.text, 'text', FEEDBACK_TEXT_MAX_LENGTH) ?? '';
      validatePoints(points);

      try {
        return await saveSessionReport(
          ctx.prisma,
          { sessionId, studentId, text, points, staffId: caller.userId },
          caller.role
        );
      } catch (error) {
        throw toReportError(error, sessionId, studentId);
      }
    },

    sendSessionReport: async (
      _parent: unknown,
      args: SendSessionReportArgs,
      ctx: GraphQLContext
    ): Promise<SessionReport> => {
      const caller = requireRole(ctx.auth, staffRoles);
      const studentId = validatePositiveInt(args.studentId, 'studentId');

      try {
        return await sendSessionReport(ctx.prisma, args.sessionId, studentId, caller.role);
      } catch (error) {
        throw toReportError(error, args.sessionId, studentId);
      }
    },
  },

  SessionReport: {
    sentAt: (report: SessionReport) =>
      (report.points?.sent_at ?? report.feedback?.sent_at)?.toISOString() ?? null,
  },
};
