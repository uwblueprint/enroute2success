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

async function assertSessionExists(prisma: PrismaClient, sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });

  if (!session) {
    throw new SessionNotFoundError();
  }
}

export async function listSessionPoints(
  prisma: PrismaClient,
  sessionId: string
): Promise<SessionPoints[]> {
  await assertSessionExists(prisma, sessionId);

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

export async function listStudentPoints(
  prisma: PrismaClient,
  activeStudentId: number
): Promise<SessionPoints[]> {
  return prisma.sessionPoints.findMany({
    where: { membership_id: activeStudentId },
    orderBy: { session: { start_datetime: 'desc' } },
  });
}

export async function getMySessionPoints(
  prisma: PrismaClient,
  activeStudentId: number,
  sessionId: string
): Promise<SessionPoints | null> {
  await assertSessionExists(prisma, sessionId);

  return getStudentSessionPoints(prisma, activeStudentId, sessionId);
}
