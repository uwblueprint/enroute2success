import { Prisma, Role } from '../../generated/client';
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

export class StudentNotFoundError extends Error {
  constructor() {
    super('Student not found');
    this.name = 'StudentNotFoundError';
  }
}

export class FeedbackNotFoundError extends Error {
  constructor() {
    super('Feedback not found');
    this.name = 'FeedbackNotFoundError';
  }
}

export class FeedbackAlreadyExistsError extends Error {
  constructor() {
    super('Feedback already exists for this student and session; use updateFeedback instead');
    this.name = 'FeedbackAlreadyExistsError';
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

export async function createFeedback(
  prisma: PrismaClient,
  input: CreateFeedbackInput,
  role: Role
): Promise<Feedback> {
  const session = await prisma.session.findUnique({
    where: { id: input.session_id },
    select: { start_datetime: true },
  });

  if (!session) {
    throw new SessionNotFoundError();
  }

  const student = await prisma.student.findUnique({
    where: { membership_id: input.receiver },
    select: { membership_id: true },
  });

  if (!student) {
    throw new StudentNotFoundError();
  }

  assertFeedbackEditWindow(role, session.start_datetime);

  // TODO: Validate student enrollment once the attendance table exists.
  // TODO: Restrict coaches/volunteers to assigned sessions once session assignment exists.

  try {
    return await prisma.feedback.create({
      data: {
        receiver: input.receiver,
        session_id: input.session_id,
        text: input.text,
        giver: input.giver,
        updated_by: input.giver,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existingFeedback = await getStudentSessionFeedback(
        prisma,
        input.receiver,
        input.session_id
      );

      if (existingFeedback) {
        throw new FeedbackAlreadyExistsError();
      }
    }

    throw error;
  }
}

export async function updateFeedback(
  prisma: PrismaClient,
  input: UpdateFeedbackInput,
  role: Role
): Promise<Feedback> {
  const feedback = await prisma.feedback.findUnique({
    where: { id: input.id },
    select: { session: { select: { start_datetime: true } } },
  });

  if (!feedback) {
    throw new FeedbackNotFoundError();
  }

  assertFeedbackEditWindow(role, feedback.session.start_datetime);

  // TODO: Restrict coaches/volunteers to assigned sessions once session assignment exists.

  try {
    return await prisma.feedback.update({
      where: { id: input.id },
      data: { text: input.text, updated_by: input.updated_by },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new FeedbackNotFoundError();
    }

    throw error;
  }
}
