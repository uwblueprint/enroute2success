import type { PrismaClient, session, session_status } from '../../generated/client';
import { localDayStartUtc, nextLocalDayStartUtc } from '../utils/datetime';

export async function listSessionsInRange(
  prisma: PrismaClient,
  from: string,
  to: string,
  statuses: session_status[] | null | undefined
): Promise<session[]> {
  return prisma.session.findMany({
    where: {
      start_datetime: { gte: localDayStartUtc(from), lt: nextLocalDayStartUtc(to) },
      // An empty list or null means "all statuses".
      ...(statuses?.length && { status: { in: statuses } }),
    },
    orderBy: { start_datetime: 'asc' },
  });
}

export async function getSessionById(prisma: PrismaClient, id: string): Promise<session | null> {
  return prisma.session.findUnique({ where: { id } });
}
