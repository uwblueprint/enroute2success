import type { PrismaClient, session, session_status } from '../../generated/client';
import { currentLocalMonthYear, monthRangeUtc } from '../utils/datetime';

export type MonthYear = {
  month: number;
  year: number;
};

export async function listSessionsForMonth(
  prisma: PrismaClient,
  target: MonthYear | null,
  statuses: session_status[] | null | undefined
): Promise<session[]> {
  const { month, year } = target ?? currentLocalMonthYear();

  // Compute UTC boundaries from the ORG's local timezone so sessions near
  // midnight land in the correct local month.
  const range = monthRangeUtc(year, month);

  return prisma.session.findMany({
    where: {
      start_datetime: { gte: range.gte, lt: range.lt },
      // An empty list or null means "all statuses".
      ...(statuses?.length && { status: { in: statuses } }),
    },
    orderBy: { start_datetime: 'asc' },
  });
}

export async function getSessionById(prisma: PrismaClient, id: string): Promise<session | null> {
  return prisma.session.findUnique({ where: { id } });
}
