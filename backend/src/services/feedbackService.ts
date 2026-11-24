import type { Feedback, PrismaClient } from '../../generated/client';

export class SessionNotFoundError extends Error {
  constructor() {
    super('Session not found');
    this.name = 'SessionNotFoundError';
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
  studentId: number
): Promise<Feedback[]> {
  return prisma.feedback.findMany({
    where: { receiver: studentId },
    orderBy: { session: { start_datetime: 'desc' } },
  });
}

export async function listVisibleStudentFeedback(
  prisma: PrismaClient,
  studentId: number
): Promise<Feedback[]> {
  return prisma.feedback.findMany({
    where: {
      receiver: studentId,
      sent_at: { not: null },
      text: { not: '' },
      session: { status: { not: 'draft' } },
    },
    orderBy: { session: { start_datetime: 'desc' } },
  });
}

export async function getVisibleStudentSessionFeedback(
  prisma: PrismaClient,
  studentId: number,
  sessionId: string
): Promise<Feedback | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true },
  });

  if (!session || session.status === 'draft') {
    throw new SessionNotFoundError();
  }

  const feedback = await getStudentSessionFeedback(prisma, studentId, sessionId);

  return feedback?.sent_at && feedback.text !== '' ? feedback : null;
}
