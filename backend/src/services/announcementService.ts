import { Prisma } from '../../generated/client';
import type { Announcements, PrismaClient } from '../../generated/client';
import { currentLocalDate, localDayEndUtc, localDayStartUtc } from '../utils/datetime';

/** Dates are calendar days written 'YYYY-MM-DD' in the org's timezone. */
export type CreateAnnouncementInput = {
  message: string;
  start_date: string;
  end_date?: string | null;
};

/** Dates are calendar days written 'YYYY-MM-DD' in the org's timezone. */
export type UpdateAnnouncementInput = {
  message?: string;
  start_date?: string;
  end_date?: string;
};

// Typed errors let the resolver choose the GraphQL error code without the
// service needing to know anything about GraphQL.
export class AnnouncementInvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnnouncementInvalidInputError';
  }
}

export class AnnouncementNotFoundError extends Error {
  constructor() {
    super('Announcement not found');
    this.name = 'AnnouncementNotFoundError';
  }
}

export class AnnouncementNotModifiableError extends Error {
  constructor() {
    super('Only live or upcoming announcements can be changed');
    this.name = 'AnnouncementNotModifiableError';
  }
}

// "Live or upcoming" = not deleted and the end of its last day hasn't passed.
function liveOrUpcomingWhere(now: Date): { deleted_at: null; end_date: { gte: Date } } {
  return { deleted_at: null, end_date: { gte: now } };
}

/** Announcements that are live right now. Oldest start first. */
export async function listCurrentAnnouncements(prisma: PrismaClient): Promise<Announcements[]> {
  const now = new Date();
  const rows = await prisma.announcements.findMany({
    where: { ...liveOrUpcomingWhere(now), start_date: { lte: now } },
    orderBy: { start_date: 'asc' },
  });
  return rows;
}

/** Announcements that are live now or start in the future. Oldest start first. */
export async function listLiveAndUpcomingAnnouncements(
  prisma: PrismaClient
): Promise<Announcements[]> {
  const rows = await prisma.announcements.findMany({
    where: liveOrUpcomingWhere(new Date()),
    orderBy: { start_date: 'asc' },
  });
  return rows;
}

/**
 * History for admins: everything that is no longer live or upcoming, meaning
 * it has expired OR was soft-deleted. Newest start first.
 */
export async function listPastAnnouncements(prisma: PrismaClient): Promise<Announcements[]> {
  const rows = await prisma.announcements.findMany({
    where: { OR: [{ end_date: { lt: new Date() } }, { deleted_at: { not: null } }] },
    orderBy: { start_date: 'desc' },
  });
  return rows;
}

export async function createAnnouncement(
  prisma: PrismaClient,
  createdBy: string,
  input: CreateAnnouncementInput
): Promise<Announcements> {
  const today = currentLocalDate();
  const startDay = input.start_date;
  // The table requires an end date, so an announcement with none ends on the
  // day it starts.
  const endDay = input.end_date ?? startDay;

  // Calendar-day strings ('YYYY-MM-DD') compare correctly as plain strings.
  if (startDay < today) {
    throw new AnnouncementInvalidInputError('start_date must be today or later');
  }
  if (endDay < today) {
    throw new AnnouncementInvalidInputError('end_date must be today or later');
  }
  if (endDay < startDay) {
    throw new AnnouncementInvalidInputError('end_date cannot be before start_date');
  }

  const row = await prisma.announcements.create({
    data: {
      message: input.message,
      start_date: localDayStartUtc(startDay),
      end_date: localDayEndUtc(endDay),
      created_by: createdBy,
    },
  });
  return row;
}

// Loads an announcement and confirms it can still be changed.
async function getModifiableOrThrow(
  prisma: PrismaClient,
  id: string,
  now: Date
): Promise<Announcements> {
  const row = await prisma.announcements.findUnique({ where: { id } });
  if (!row) {
    throw new AnnouncementNotFoundError();
  }
  if (row.deleted_at !== null || row.end_date.getTime() < now.getTime()) {
    throw new AnnouncementNotModifiableError();
  }
  return row;
}

// Runs a write that is guarded by "still live or upcoming". The guard is part
// of the UPDATE's WHERE clause, so an announcement that is deleted or expires
// between our read and our write makes the write fail instead of slipping through.
async function updateIfModifiable(
  prisma: PrismaClient,
  id: string,
  now: Date,
  data: Prisma.AnnouncementsUpdateInput
): Promise<Announcements> {
  try {
    const row = await prisma.announcements.update({
      where: { id, ...liveOrUpcomingWhere(now) },
      data,
    });
    return row;
  } catch (error) {
    // P2025: no row matched the WHERE clause.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new AnnouncementNotModifiableError();
    }
    throw error;
  }
}

export async function updateAnnouncement(
  prisma: PrismaClient,
  id: string,
  input: UpdateAnnouncementInput
): Promise<Announcements> {
  const now = new Date();
  const existing = await getModifiableOrThrow(prisma, id, now);

  const data: Prisma.AnnouncementsUpdateInput = {};
  if (input.message !== undefined) {
    data.message = input.message;
  }

  if (input.start_date !== undefined || input.end_date !== undefined) {
    const today = currentLocalDate(undefined, now);
    const existingStartDay = currentLocalDate(undefined, existing.start_date);
    const existingEndDay = currentLocalDate(undefined, existing.end_date);
    const startDay = input.start_date ?? existingStartDay;
    const endDay = input.end_date ?? existingEndDay;

    // A live announcement already started in the past, so re-sending its
    // current start date is fine. Moving the start into the past is not.
    if (input.start_date !== undefined && startDay !== existingStartDay && startDay < today) {
      throw new AnnouncementInvalidInputError('start_date must be today or later');
    }
    // Ending before today would make it a past announcement; deleting is how
    // an admin takes one down early.
    if (input.end_date !== undefined && endDay < today) {
      throw new AnnouncementInvalidInputError('end_date must be today or later');
    }
    if (endDay < startDay) {
      throw new AnnouncementInvalidInputError('end_date cannot be before start_date');
    }

    if (input.start_date !== undefined) {
      data.start_date = localDayStartUtc(startDay);
    }
    if (input.end_date !== undefined) {
      data.end_date = localDayEndUtc(endDay);
    }
  }

  return updateIfModifiable(prisma, id, now, data);
}

/** Soft delete: sets `deleted_at` instead of removing the row. */
export async function deleteAnnouncement(prisma: PrismaClient, id: string): Promise<Announcements> {
  const now = new Date();
  await getModifiableOrThrow(prisma, id, now);
  return updateIfModifiable(prisma, id, now, { deleted_at: now });
}
