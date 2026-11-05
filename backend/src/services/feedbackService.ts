import { Role } from '../../generated/client';
import type { Feedback, PrismaClient } from '../../generated/client';
import { zonedWallTimeToUtc } from '../utils/datetime';

const FEEDBACK_TIMEZONE = 'America/Toronto';
const FEEDBACK_LOOKBACK_DAYS = 7;

export type CreateFeedbackInput = {
  receiver: number;
  session_id: string;
  text: string;
  giver: string;
};

export type UpdateFeedbackInput = {
  id: string;
  text: string;
  updated_by: string;
};

export class SessionNotFoundError extends Error {
  constructor() {
    super('Session not found');
    this.name = 'SessionNotFoundError';
  }
}

export class FeedbackEditWindowError extends Error {
  constructor() {
    super(
      'Feedback can only be created or edited from the session date through the seventh calendar day afterward'
    );
    this.name = 'FeedbackEditWindowError';
  }
}

export function assertFeedbackEditWindow(
  role: Role,
  sessionStart: Date,
  now: Date = new Date()
): void {
  if (role === Role.ADMIN) {
    return;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FEEDBACK_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(sessionStart);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');

  const windowStart = zonedWallTimeToUtc(year, month, day, FEEDBACK_TIMEZONE);
  const windowEnd = zonedWallTimeToUtc(
    year,
    month,
    day + FEEDBACK_LOOKBACK_DAYS + 1,
    FEEDBACK_TIMEZONE
  );

  if (now < windowStart || now >= windowEnd) {
    throw new FeedbackEditWindowError();
  }
}

async function assertSessionExists(prisma: PrismaClient, sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });

  if (!session) {
    throw new SessionNotFoundError();
  }
}

export async function listSessionFeedback(
  prisma: PrismaClient,
  sessionId: string
): Promise<Feedback[]> {
  await assertSessionExists(prisma, sessionId);

  return prisma.feedback.findMany({
    where: { session_id: sessionId },
    orderBy: { created_at: 'asc' },
  });
}

export async function getStudentSessionFeedback(
  prisma: PrismaClient,
  studentId: number,
  sessionId: string
): Promise<Feedback | null> {
  return prisma.feedback.findUnique({
    where: {
      receiver_session_id: { receiver: studentId, session_id: sessionId },
    },
  });
}

export async function listStudentFeedback(
  prisma: PrismaClient,
  activeStudentId: number
): Promise<Feedback[]> {
  return prisma.feedback.findMany({
    where: { receiver: activeStudentId },
    orderBy: { session: { start_datetime: 'desc' } },
  });
}

export async function getMySessionFeedback(
  prisma: PrismaClient,
  activeStudentId: number,
  sessionId: string
): Promise<Feedback | null> {
  await assertSessionExists(prisma, sessionId);

  return getStudentSessionFeedback(prisma, activeStudentId, sessionId);
}
