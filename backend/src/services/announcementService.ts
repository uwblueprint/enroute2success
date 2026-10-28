import { randomUUID } from 'node:crypto';
import type { PrismaClient, Announcements } from '../../generated/client';
import { ORG_TIMEZONE, dayEndUtc, dayStartUtc } from '../utils/datetime';

export type CreateAccouncementInput = {
  message: string;
  start_date: string;
  end_date?: string | null;
  created_by: string;
};

export type UpdateAnnouncementInput = {
  id: string;
  input: {
    message?: string | null;
    start_date?: string | null;
    end_date?: string | null;
  };
};

export class AnnouncementValidationError extends Error {
  readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = 'AnnouncementValidationError';
    this.field = field;
  }
}

export class AnnouncementNotFoundError extends Error {
  constructor() {
    super('Announcement not found');
    this.name = 'AnnouncementNotFoundError';
  }
}

export class AnnouncementNotEditableError extends Error {
  constructor(message = 'Only live or upcoming announcements can be modified') {
    super(message);
    this.name = 'AnnouncementNotEditableError';
  }
}

function todayLocalDateString(timeZone: string = ORG_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function calendarDatePart(dateStr: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(dateStr);
  return match ? match[1] : dateStr;
}

function utcToLocalDateString(instant: Date, timeZone: string = ORG_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export class AnnouncementService {
  // start_date 12:00 AM of day
  // end_date 11:59:59.999 PM of day
  async createAnnouncement(
    prisma: PrismaClient,
    input: CreateAccouncementInput
  ): Promise<Announcements> {
    const today = todayLocalDateString();
    const startDate = calendarDatePart(input.start_date);
    const endDate = input.end_date != null ? calendarDatePart(input.end_date) : startDate;

    let startUtc: Date;
    let endUtc: Date;
    try {
      startUtc = dayStartUtc(startDate);
    } catch {
      throw new AnnouncementValidationError('start_date is not a valid date', 'start_date');
    }
    try {
      endUtc = dayEndUtc(endDate);
    } catch {
      throw new AnnouncementValidationError('end_date is not a valid date', 'end_date');
    }

    if (startDate < today) {
      throw new AnnouncementValidationError('start_date must be today or later', 'start_date');
    }
    if (endDate < today) {
      throw new AnnouncementValidationError('end_date must be today or later', 'end_date');
    }
    if (endDate < startDate) {
      throw new AnnouncementValidationError('end_date must not be before start_date', 'end_date');
    }

    return prisma.announcements.create({
      data: {
        id: randomUUID(),
        message: input.message,
        start_date: startUtc,
        end_date: endUtc,
        created_by: input.created_by,
      },
    });
  }

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

  async updateAnnouncement(
    prisma: PrismaClient,
    { id, input }: UpdateAnnouncementInput
  ): Promise<Announcements> {
    const found = await prisma.announcements.findUnique({ where: { id } });

    if (!found) {
      throw new AnnouncementNotFoundError();
    }

    if (found.deleted_at !== null) {
      throw new AnnouncementNotEditableError('Cannot modify a deleted announcement');
    }
    if (found.end_date.getTime() < Date.now()) {
      throw new AnnouncementNotEditableError('Cannot modify a past announcement');
    }

    const today = todayLocalDateString();
    const startProvided = input.start_date != null;
    const endProvided = input.end_date != null;
    const startDate = startProvided
      ? calendarDatePart(input.start_date as string)
      : utcToLocalDateString(found.start_date);
    const endDate = endProvided
      ? calendarDatePart(input.end_date as string)
      : utcToLocalDateString(found.end_date);

    let startUtc: Date;
    let endUtc: Date;
    try {
      startUtc = dayStartUtc(startDate);
    } catch {
      throw new AnnouncementValidationError('start_date is not a valid date', 'start_date');
    }
    try {
      endUtc = dayEndUtc(endDate);
    } catch {
      throw new AnnouncementValidationError('end_date is not a valid date', 'end_date');
    }

    if (startProvided && startDate < today) {
      throw new AnnouncementValidationError('start_date must be today or later', 'start_date');
    }
    if (endProvided && endDate < today) {
      throw new AnnouncementValidationError('end_date must be today or later', 'end_date');
    }
    if (endDate < startDate) {
      throw new AnnouncementValidationError('end_date must not be before start_date', 'end_date');
    }

    return prisma.announcements.update({
      where: { id },
      data: {
        ...(input.message != null ? { message: input.message } : {}),
        ...(startProvided ? { start_date: startUtc } : {}),
        ...(endProvided ? { end_date: endUtc } : {}),
      },
    });
  }

  // Soft-deletes an announcement by setting `deleted_at` to the current
  // timestamp. Only allowed on live or upcoming announcements (not already
  // deleted and not past); throws otherwise. Returns the deleted announcement.
  async deleteAnnouncement(prisma: PrismaClient, { id }: { id: string }): Promise<Announcements> {
    const found = await prisma.announcements.findUnique({ where: { id } });

    if (!found) {
      throw new AnnouncementNotFoundError();
    }

    if (found.deleted_at !== null) {
      throw new AnnouncementNotEditableError('Announcement is already deleted');
    }
    if (found.end_date.getTime() < Date.now()) {
      throw new AnnouncementNotEditableError('Cannot delete a past announcement');
    }

    return prisma.announcements.update({
      where: { id },
      data: { deleted_at: new Date() },
    });
  }
}

// Export a singleton instance or individual functions
export const announcementService = new AnnouncementService();
