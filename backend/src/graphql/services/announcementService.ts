import type { PrismaClient, Announcements } from '../../../generated/client';
import { currentLocalMonthYear, monthRangeUtc } from '../../utils/datetime';

export class AnnouncementService {
  async getCurrentAnnouncements(prisma: PrismaClient): Promise<Announcements[]> {
    const now = new Date();
    return await prisma.announcements.findMany({
      where: {
        start_date: {
          lte: now,
        },
        end_date: {
          gte: now,
        },
        deleted_at: {
          equals: null,
        },
      },
      orderBy: {
        start_date: 'asc',
      },
    });
  }

  async getLiveAndUpcomingAnnouncements(prisma: PrismaClient): Promise<Announcements[]> {
    const now = new Date();
    return await prisma.announcements.findMany({
      where: {
        end_date: {
          gte: now,
        },
        deleted_at: {
          equals: null,
        },
      },
      orderBy: {
        start_date: 'asc',
      },
    });
  }

  async getPastAnnouncements(prisma: PrismaClient): Promise<Announcements[]> {
    const now = new Date();
    return await prisma.announcements.findMany({
      where: {
        end_date: {
          lt: now,
        },
        deleted_at: {
          equals: null,
        },
      },
      orderBy: {
        start_date: 'asc',
      },
    });
  }
}

// Export a singleton instance or individual functions
export const announcementService = new AnnouncementService();