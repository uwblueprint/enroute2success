import { Prisma, Role } from '../../generated/client';
import type { PrismaClient, SessionPoints } from '../../generated/client';
import { isWithinSessionEditWindow } from '../utils/datetime';

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

export type CreateSessionPointsInput = SessionPointsCategories & {
  membershipId: number;
  sessionId: string;
  givenBy: string;
};

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

export class SessionPointsAlreadyExistsError extends Error {
  constructor() {
    super(
      'Points already exist for this student and session. Use updateSessionPoints to edit them.'
    );
    this.name = 'SessionPointsAlreadyExistsError';
  }
}

export class SessionPointsEditWindowError extends Error {
  constructor() {
    super(
      'Session points can only be created or edited from the session date through the seventh calendar day afterward'
    );
    this.name = 'SessionPointsEditWindowError';
  }
}

async function requireSession(prisma: PrismaClient, sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { start_datetime: true },
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
    where: { membership_id: activeStudentId },
    orderBy: { session: { start_datetime: 'desc' } },
  });
}

export async function getMySessionPoints(
  prisma: PrismaClient,
  activeStudentId: number,
  sessionId: string
): Promise<SessionPoints | null> {
  await requireSession(prisma, sessionId);

  return getStudentSessionPoints(prisma, activeStudentId, sessionId);
}

export async function createSessionPoints(
  prisma: PrismaClient,
  input: CreateSessionPointsInput,
  role: Role
): Promise<SessionPoints> {
  const { membershipId, sessionId, givenBy } = input;
  const session = await requireSession(prisma, sessionId);
  const student = await prisma.student.findUnique({
    where: { membership_id: membershipId },
    select: { membership_id: true },
  });

  if (!student) {
    throw new StudentNotFoundError();
  }

  if (role !== Role.ADMIN && !isWithinSessionEditWindow(session.start_datetime)) {
    throw new SessionPointsEditWindowError();
  }

  // TODO: Validate student enrollment once the attendance table exists.

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.sessionPoints.create({
        data: {
          membership_id: membershipId,
          session_id: sessionId,
          given_by: givenBy,
          updated_by: givenBy,
          attendance: input.attendance,
          punctuality: input.punctuality,
          teamwork: input.teamwork,
          focus: input.focus,
          discipline: input.discipline,
          respect: input.respect,
          sportsmanship: input.sportsmanship,
          extra_recognition: input.extraRecognition,
          attended_workshop: input.attendedWorkshop,
          won_tournament: input.wonTournament,
        },
      });

      await tx.student.update({
        where: { membership_id: membershipId },
        data: { points: { increment: sumSessionPoints(created) } },
      });

      return created;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // The PostgreSQL adapter reports the violated index in the underlying error.
      const adapterError = error.meta?.driverAdapterError as
        { cause?: { constraint?: { index?: string } } } | undefined;

      if (
        adapterError?.cause?.constraint?.index === 'session_points_session_id_membership_id_key'
      ) {
        throw new SessionPointsAlreadyExistsError();
      }
    }

    throw error;
  }
}
