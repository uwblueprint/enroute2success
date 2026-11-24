import type { PrismaClient, SessionPoints } from '../../generated/client';

type SessionPointScores = Pick<
  SessionPoints,
  | 'attendance'
  | 'punctuality'
  | 'teamwork'
  | 'focus'
  | 'discipline'
  | 'respect'
  | 'sportsmanship'
  | 'extra_recognition'
  | 'attended_workshop'
  | 'won_tournament'
>;

export function sumSessionPoints(scores: SessionPointScores): number {
  return (
    scores.attendance +
    scores.punctuality +
    scores.teamwork +
    scores.focus +
    scores.discipline +
    scores.respect +
    scores.sportsmanship +
    scores.extra_recognition +
    scores.attended_workshop +
    scores.won_tournament
  );
}

export class SessionNotFoundError extends Error {
  constructor() {
    super('Session not found');
    this.name = 'SessionNotFoundError';
  }
}

export async function listSessionPoints(
  prisma: PrismaClient,
  sessionId: string
): Promise<SessionPoints[]> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });

  if (!session) {
    throw new SessionNotFoundError();
  }

  return prisma.sessionPoints.findMany({
    where: { session_id: sessionId },
    orderBy: { created_at: 'asc' },
  });
}

export async function getStudentSessionPoints(
  prisma: PrismaClient,
  studentId: number,
  sessionId: string
): Promise<SessionPoints | null> {
  return prisma.sessionPoints.findUnique({
    where: {
      session_id_membership_id: { session_id: sessionId, membership_id: studentId },
    },
  });
}
