import type { Feedback, PrismaClient } from '../../generated/client';

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
