import { Role } from '../../generated/client';
import type { Feedback, Prisma, PrismaClient, SessionPoints } from '../../generated/client';
import { isWithinSessionEditWindow } from '../utils/datetime';
import {
  SessionNotFoundError,
  StudentNotFoundError,
  sumSessionPoints,
  toSessionPointScores,
} from './sessionPointsService';
import type { SessionPointsCategories } from './sessionPointsService';

export type SessionReport = {
  sessionId: string;
  studentId: number;
  feedback: Feedback | null;
  points: SessionPoints | null;
};

export type SaveSessionReportInput = {
  sessionId: string;
  studentId: number;
  text: string;
  points: SessionPointsCategories;
  staffId: string;
};

export class SessionReportNotFoundError extends Error {
  constructor() {
    super('Nothing has been saved for this student and session yet');
    this.name = 'SessionReportNotFoundError';
  }
}

export class SessionReportEditWindowError extends Error {
  constructor() {
    super(
      'Points and feedback can only be saved or sent from the session date through the seventh calendar day afterward'
    );
    this.name = 'SessionReportEditWindowError';
  }
}

function assertEditWindow(role: Role, sessionStart: Date): void {
  if (role !== Role.ADMIN && !isWithinSessionEditWindow(sessionStart)) {
    throw new SessionReportEditWindowError();
  }
}

// Locks the student row so saves and sends for the same student run one at a time. Otherwise two
// concurrent requests could both create a report, or both add the same sent points to
// Student.points.
async function lockStudentForSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
  studentId: number
): Promise<Date> {
  const session = await tx.session.findUnique({
    where: { id: sessionId },
    select: { start_datetime: true },
  });

  if (!session) {
    throw new SessionNotFoundError();
  }

  const locked = await tx.$queryRaw<{ membership_id: number }[]>`
    SELECT "membership_id" FROM "students"
    WHERE "membership_id" = ${studentId}
    FOR UPDATE
  `;

  if (locked.length === 0) {
    throw new StudentNotFoundError();
  }

  return session.start_datetime;
}

async function findReport(
  tx: Prisma.TransactionClient,
  sessionId: string,
  studentId: number
): Promise<SessionReport> {
  const feedback = await tx.feedback.findUnique({
    where: { receiver_session_id: { receiver: studentId, session_id: sessionId } },
  });
  const points = await tx.sessionPoints.findUnique({
    where: { session_id_membership_id: { session_id: sessionId, membership_id: studentId } },
  });

  return { sessionId, studentId, feedback, points };
}

export async function saveSessionReport(
  prisma: PrismaClient,
  input: SaveSessionReportInput,
  role: Role
): Promise<SessionReport> {
  const { sessionId, studentId, text, staffId } = input;
  const scores = toSessionPointScores(input.points);

  return prisma.$transaction(
    async (tx) => {
      const sessionStart = await lockStudentForSession(tx, sessionId, studentId);
      assertEditWindow(role, sessionStart);

      // TODO: Validate student enrollment once the attendance table exists.
      // TODO: Restrict coaches/volunteers to assigned sessions once session assignment exists.

      const existing = await findReport(tx, sessionId, studentId);

      const points = existing.points
        ? await tx.sessionPoints.update({
            where: { id: existing.points.id },
            data: { ...scores, updated_by: staffId },
          })
        : await tx.sessionPoints.create({
            data: {
              session_id: sessionId,
              membership_id: studentId,
              given_by: staffId,
              updated_by: staffId,
              ...scores,
            },
          });

      // Sent points already count toward the student's total, and edits to them go out right away.
      if (existing.points?.sent_at) {
        const delta = sumSessionPoints(points) - sumSessionPoints(existing.points);

        if (delta !== 0) {
          await tx.student.update({
            where: { membership_id: studentId },
            data: { points: { increment: delta } },
          });
        }
      }

      const feedback = existing.feedback
        ? await tx.feedback.update({
            where: { id: existing.feedback.id },
            data: { text, updated_by: staffId },
          })
        : await tx.feedback.create({
            data: {
              receiver: studentId,
              session_id: sessionId,
              text,
              giver: staffId,
              updated_by: staffId,
            },
          });

      return { sessionId, studentId, feedback, points };
    },
    { isolationLevel: 'ReadCommitted' }
  );
}

export async function sendSessionReport(
  prisma: PrismaClient,
  sessionId: string,
  studentId: number,
  role: Role
): Promise<SessionReport> {
  return prisma.$transaction(
    async (tx) => {
      const sessionStart = await lockStudentForSession(tx, sessionId, studentId);
      const report = await findReport(tx, sessionId, studentId);
      let { feedback, points } = report;

      if (!feedback && !points) {
        throw new SessionReportNotFoundError();
      }

      // Sending again keeps the original sent_at, even after the edit window has closed.
      if ((!feedback || feedback.sent_at) && (!points || points.sent_at)) {
        return report;
      }

      assertEditWindow(role, sessionStart);
      const sentAt = new Date();

      if (points && !points.sent_at) {
        points = await tx.sessionPoints.update({
          where: { id: points.id },
          data: { sent_at: sentAt },
        });
        const total = sumSessionPoints(points);

        if (total !== 0) {
          await tx.student.update({
            where: { membership_id: studentId },
            data: { points: { increment: total } },
          });
        }
      }

      if (feedback && !feedback.sent_at) {
        feedback = await tx.feedback.update({
          where: { id: feedback.id },
          data: { sent_at: sentAt },
        });
      }

      return { sessionId, studentId, feedback, points };
    },
    { isolationLevel: 'ReadCommitted' }
  );
}
