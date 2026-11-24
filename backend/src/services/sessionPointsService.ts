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

export type SessionPointsCategories = Omit<
  SessionPointScores,
  'extra_recognition' | 'attended_workshop' | 'won_tournament'
> & {
  extraRecognition: number;
  attendedWorkshop: number;
  wonTournament: number;
};

export function toSessionPointScores(categories: SessionPointsCategories): SessionPointScores {
  return {
    attendance: categories.attendance,
    punctuality: categories.punctuality,
    teamwork: categories.teamwork,
    focus: categories.focus,
    discipline: categories.discipline,
    respect: categories.respect,
    sportsmanship: categories.sportsmanship,
    extra_recognition: categories.extraRecognition,
    attended_workshop: categories.attendedWorkshop,
    won_tournament: categories.wonTournament,
  };
}

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

export class StudentNotFoundError extends Error {
  constructor() {
    super('Student not found');
    this.name = 'StudentNotFoundError';
  }
}

async function requireSession(prisma: PrismaClient, sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true },
  });

  if (!session) {
    throw new SessionNotFoundError();
  }

  return session;
}

export async function listSessionPoints(
  prisma: PrismaClient,
  sessionId: string
): Promise<SessionPoints[]> {
  await requireSession(prisma, sessionId);

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
    where: {
      membership_id: activeStudentId,
      sent_at: { not: null },
      session: { status: { not: 'draft' } },
    },
    orderBy: { session: { start_datetime: 'desc' } },
  });
}

export async function getMySessionPoints(
  prisma: PrismaClient,
  activeStudentId: number,
  sessionId: string
): Promise<SessionPoints | null> {
  const session = await requireSession(prisma, sessionId);

  if (session.status === 'draft') {
    throw new SessionNotFoundError();
  }

  const points = await getStudentSessionPoints(prisma, activeStudentId, sessionId);

  return points?.sent_at ? points : null;
}
