/**
 * Dev-only seed for staff accounts and sessions.
 *
 * ⚠️  NOT FOR PRODUCTION. It requires NODE_ENV=development and a DATABASE_URL
 * pointing at the local e2s_db database.
 *
 * Run with:  npm run db:seed   (see package.json and README.md)
 *
 * Staff accounts: creates the four fixture accounts if missing and leaves
 * existing matching accounts unchanged (including passwords). Rolls back if a
 * fixture ID or email belongs to a different account.
 *
 * Sessions: wipes existing sessions/series and inserts fixture data to
 * exercise the month-browse + session(id) features without an admin UI.
 * Fixture coverage (maps to the testing checklist):
 *  - Sessions with AND without `max_attendees`.
 *  - One `draft` and one `cancelled` session.
 *  - Two sessions on the SAME local day.
 *  - One near midnight on the LAST day of a month (timezone edge case).
 *  - One in a PAST month.
 *  - One belonging to a `session_series`, and one one-off (null series).
 */
import 'dotenv/config';
import { StaffType } from '../../generated/client';
import type { session_status, session_type } from '../../generated/client';
import {
  ORG_TIMEZONE,
  zonedWallTimeToUtc,
  currentLocalMonthYear,
  dayStartUtc,
  dayEndUtc,
} from '../utils/datetime';
import { hashPassword } from '../utils/passwords';
import { prisma } from '../prisma';

const DEV_PASSWORD = 'DevOnly!12345';

const accounts = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'admin@e2s.test',
    lastName: 'Admin',
    role: StaffType.ADMIN,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'coach@e2s.test',
    lastName: 'Coach',
    role: StaffType.COACH,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    email: 'volunteer@e2s.test',
    lastName: 'Volunteer',
    role: StaffType.VOLUNTEER,
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    email: 'nonstaff@e2s.test',
    lastName: 'Nonstaff',
    role: null,
  },
];

const DEV_DATABASE_HOSTS = ['postgres', 'localhost', '127.0.0.1'];

class SeedError extends Error {}

function requireDevelopmentDatabase(): void {
  if (process.env.NODE_ENV !== 'development') {
    throw new SeedError('Dev seeding requires NODE_ENV=development.');
  }

  let target: URL;
  try {
    target = new URL(process.env.DATABASE_URL ?? '');
  } catch {
    throw new SeedError('Dev seeding requires a valid development DATABASE_URL.');
  }

  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !DEV_DATABASE_HOSTS.includes(target.hostname) ||
    (target.port || '5432') !== '5432' ||
    target.pathname !== '/e2s_db'
  ) {
    throw new SeedError(
      'Dev seeding only supports the local database e2s_db on port 5432 (host postgres, localhost, or 127.0.0.1).'
    );
  }
}

async function seedStaffAccounts(): Promise<void> {
  const preparedAccounts = await Promise.all(
    accounts.map(async (account) => ({
      ...account,
      passwordHash: await hashPassword(DEV_PASSWORD),
    }))
  );

  const created = await prisma.$transaction(
    async (tx) => {
      let count = 0;

      for (const account of preparedAccounts) {
        const existing = await tx.user.findFirst({
          where: { OR: [{ id: account.id }, { email: account.email }] },
          select: { id: true, email: true },
        });

        if (existing) {
          if (existing.id !== account.id || existing.email !== account.email) {
            throw new SeedError(
              'A seed ID or email belongs to another account; account seeding was rolled back.'
            );
          }

          continue;
        }

        await tx.user.create({
          data: {
            id: account.id,
            first_name: 'Dev',
            last_name: account.lastName,
            email: account.email,
            phone_number: '0000000000',
            password_hash: account.passwordHash,
            ...(account.role === null ? {} : { staff: { create: { staffType: account.role } } }),
          },
        });
        count += 1;
      }

      return count;
    },
    { isolationLevel: 'ReadCommitted' }
  );

  console.log(`✅ Created ${created} dev auth accounts; existing accounts were unchanged.`);
}

/** Build a UTC Date from local wall-clock parts in the ORG timezone. */
function local(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  // zonedWallTimeToUtc resolves local midnight; add the intra-day offset.
  const midnightUtc = zonedWallTimeToUtc(year, month, day);
  return new Date(midnightUtc.getTime() + (hour * 60 + minute) * 60000);
}

async function seedSessions(): Promise<void> {
  const { month, year } = currentLocalMonthYear();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevMonthYear = month === 1 ? year - 1 : year;
  // Last day of the CURRENT local month (day 0 of next month = last day of this one).
  const lastDay = new Date(year, month, 0).getDate();

  console.log(
    `🌱 Seeding sessions for local timezone ${ORG_TIMEZONE}. ` +
      `Current local month: ${year}-${String(month).padStart(2, '0')}.`
  );

  // Idempotent: clear existing data (FK: delete sessions before series).
  await prisma.session.deleteMany({});
  await prisma.session_series.deleteMany({});

  // ---- A recurring series that one session will belong to ----
  const series = await prisma.session_series.create({
    data: {
      recurrence: 'WEEKLY',
      name: 'Saturday Youth Golf Clinic',
      description: 'Recurring weekend golf clinic for members.',
      location: 'City Driving Range',
      max_attendees: 20,
      session_type: 'golf' as session_type,
      // DATE/TIME columns: date-only and time-only values are anchored to an
      // arbitrary epoch day (TIME) or midnight (DATE); Prisma maps them to the
      // bare DB DATE/TIME, discarding the placeholder parts.
      start_date: new Date(Date.UTC(year, month - 1, 1)),
      end_date: null,
      start_time: new Date(Date.UTC(1970, 0, 1, 14, 0, 0)),
      end_time: new Date(Date.UTC(1970, 0, 1, 16, 0, 0)),
      image_urls: [],
    },
  });

  const draft: session_status = 'draft';
  const scheduled: session_status = 'scheduled';
  const cancelled: session_status = 'cancelled';
  const golf: session_type = 'golf';
  const chess: session_type = 'chess';

  const sessions = [
    // 1) Belongs to a series, scheduled, WITH max_attendees. Current month, mid-month.
    {
      session_series_id: series.id,
      name: 'Saturday Youth Golf Clinic — Session 1',
      description: 'First clinic of the month.',
      location: 'City Driving Range',
      max_attendees: 20,
      status: scheduled,
      session_type: golf,
      start_datetime: local(year, month, 12, 10, 0),
      end_datetime: local(year, month, 12, 12, 0),
      notes: 'Bring your own clubs if you have them.',
      image_urls: [],
    },

    // 2) One-off (null series), scheduled, WITHOUT max_attendees (null stays null).
    {
      session_series_id: null,
      name: 'Open Chess Night',
      description: 'Casual drop-in chess, all skill levels.',
      location: null, // exercises the null-optional path the UI must hide
      max_attendees: null,
      status: scheduled,
      session_type: chess,
      start_datetime: local(year, month, 12, 18, 0),
      // Overnight session: ends next calendar day. Must still appear on the 12th.
      end_datetime: local(year, month, 13, 1, 0),
      notes: null,
      image_urls: [],
    },

    // 3) SAME local day as #1/#2 (two sessions on the same day — here a third
    //    on the 12th as well) to verify same-day grouping + ordering by start.
    {
      session_series_id: null,
      name: 'Beginner Golf Basics',
      description: 'Intro lesson for first-timers.',
      location: 'City Driving Range — Bay 3',
      max_attendees: 8,
      status: scheduled,
      session_type: golf,
      start_datetime: local(year, month, 12, 9, 0), // earlier than #1
      end_datetime: local(year, month, 12, 10, 0),
      notes: null,
      image_urls: [],
    },

    // 4) DRAFT session (readable by anyone until auth lands). Current month.
    {
      session_series_id: null,
      name: 'Draft: Advanced Tactics Workshop',
      description: 'Not yet published.',
      location: 'Community Center Room B',
      max_attendees: 15,
      status: draft,
      session_type: chess,
      start_datetime: local(year, month, 18, 17, 0),
      end_datetime: local(year, month, 18, 19, 0),
      notes: 'Pending coach confirmation.',
      image_urls: [],
    },

    // 5) CANCELLED session. Current month.
    {
      session_series_id: null,
      name: 'Cancelled: Rainy Day Golf',
      description: 'Called off due to weather.',
      location: 'City Driving Range',
      max_attendees: 20,
      status: cancelled,
      session_type: golf,
      start_datetime: local(year, month, 20, 10, 0),
      end_datetime: local(year, month, 20, 12, 0),
      notes: 'Rescheduling TBD.',
      image_urls: [],
    },

    // 6) NEAR MIDNIGHT on the LAST day of the current local month. Its UTC
    //    instant may spill into the next month, but it must still browse under
    //    the current month because month boundaries are computed in local tz.
    {
      session_series_id: null,
      name: 'Late Night Blitz',
      description: 'End-of-month midnight chess blitz.',
      location: 'Community Center',
      max_attendees: 12,
      status: scheduled,
      session_type: chess,
      start_datetime: local(year, month, lastDay, 23, 30),
      end_datetime: local(year, month + 1 > 12 ? 1 : month + 1, 1, 1, 0),
      notes: null,
      image_urls: [],
    },

    // 7) PAST month session (allowed — any month, including past, is browsable).
    {
      session_series_id: null,
      name: "Last Month's Championship",
      description: 'A session that already happened.',
      location: 'Grand Hall',
      max_attendees: 50,
      status: scheduled,
      session_type: chess,
      start_datetime: local(prevMonthYear, prevMonth, 15, 14, 0),
      end_datetime: local(prevMonthYear, prevMonth, 15, 18, 0),
      notes: null,
      image_urls: [],
    },
  ];

  await prisma.session.createMany({ data: sessions });

  const total = await prisma.session.count();
  console.log(`✅ Seeded ${total} sessions (+1 session_series).`);
  console.log(
    `   • Current month (${year}-${String(month).padStart(2, '0')}): ` +
      `${sessions.filter((s) => s.start_datetime >= zonedWallTimeToUtc(year, month, 1) && s.start_datetime < zonedWallTimeToUtc(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1)).length} sessions ` +
      `(incl. 1 draft, 1 cancelled, a near-midnight edge case, and same-day sessions).`
  );
  console.log(
    `   • Past month (${prevMonthYear}-${String(prevMonth).padStart(2, '0')}): 1 session.`
  );
}

/** Admin fixture id from `accounts`; used as the announcement `created_by` FK. */
const ADMIN_FIXTURE_ID = '00000000-0000-4000-8000-000000000001';

/** Format a UTC instant as a `YYYY-MM-DD` calendar date in the ORG timezone. */
function localDateString(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ORG_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The local calendar date `deltaDays` away from today, as `YYYY-MM-DD`. */
function localDateOffset(deltaDays: number): string {
  return localDateString(new Date(Date.now() + deltaDays * 24 * 60 * 60 * 1000));
}

/**
 * Seed announcement fixtures covering every query bucket:
 *   - getCurrentAnnouncements:          start_date <= now <= end_date, not deleted
 *   - getLiveAndUpcomingAnnouncements:  end_date >= now, not deleted
 *   - getPastAnnouncements:             end_date < now, not deleted
 *
 * Dates use the same semantics as AnnouncementService.createAnnouncement:
 * start_date = 12:00 AM EST of the day (dayStartUtc), end_date = 11:59:59.999
 * PM EST of the day (dayEndUtc). `created_by` is the seeded admin account.
 */
async function seedAnnouncements(): Promise<void> {
  console.log(`🌱 Seeding announcements for local timezone ${ORG_TIMEZONE}.`);

  // Idempotent wipe. No table depends on announcements, so a single deleteMany
  // is safe. The admin FK row is created (and left intact) by seedStaffAccounts.
  await prisma.announcements.deleteMany({});

  const today = localDateOffset(0);

  const announcements = [
    // 1) LIVE now — single-day: starts today, ends today.
    //    Appears in currentAnnouncements AND liveAndUpcomingAnnouncements.
    {
      message: 'Welcome back! The clubhouse is open all day today.',
      start_date: dayStartUtc(today),
      end_date: dayEndUtc(today),
      created_by: ADMIN_FIXTURE_ID,
    },

    // 2) LIVE now — multi-day: started 3 days ago, ends 3 days from now.
    //    Appears in currentAnnouncements AND liveAndUpcomingAnnouncements.
    {
      message: 'Spring registration is open this week — sign up at the front desk.',
      start_date: dayStartUtc(localDateOffset(-3)),
      end_date: dayEndUtc(localDateOffset(3)),
      created_by: ADMIN_FIXTURE_ID,
    },

    // 3) UPCOMING — starts in 5 days, ends in 7 days.
    //    Excluded from currentAnnouncements; included in liveAndUpcomingAnnouncements.
    {
      message: 'Youth golf tournament next week — registration closes Friday.',
      start_date: dayStartUtc(localDateOffset(5)),
      end_date: dayEndUtc(localDateOffset(7)),
      created_by: ADMIN_FIXTURE_ID,
    },

    // 4) PAST/expired — started 10 days ago, ended 3 days ago, not deleted.
    //    Only appears in pastAnnouncements.
    {
      message: 'Thanks to everyone who attended last month’s chess open!',
      start_date: dayStartUtc(localDateOffset(-10)),
      end_date: dayEndUtc(localDateOffset(-3)),
      created_by: ADMIN_FIXTURE_ID,
    },

    // 5) SOFT-DELETED (currently live window) — excluded from every query
    //    because deleted_at is set. Exercises the deleted_at filter.
    {
      message: 'Deleted: duplicate facilities-closure notice.',
      start_date: dayStartUtc(localDateOffset(-1)),
      end_date: dayEndUtc(localDateOffset(2)),
      created_by: ADMIN_FIXTURE_ID,
      deleted_at: new Date(),
    },
  ];

  await prisma.announcements.createMany({ data: announcements });

  const total = await prisma.announcements.count();
  const active = announcements.filter((a) => a.deleted_at == null);
  const now = Date.now();
  const liveNow = active.filter(
    (a) => a.start_date.getTime() <= now && a.end_date.getTime() >= now
  ).length;
  const upcoming = active.filter((a) => a.start_date.getTime() > now).length;
  const past = active.filter((a) => a.end_date.getTime() < now).length;
  const deleted = announcements.length - active.length;

  console.log(`✅ Seeded ${total} announcements.`);
  console.log(
    `   • Live now: ${liveNow}  • Upcoming: ${upcoming}  • Past: ${past}  • Soft-deleted: ${deleted}.`
  );
}

async function main(): Promise<void> {
  requireDevelopmentDatabase();
  await seedStaffAccounts();
  await seedSessions();
  await seedAnnouncements();
}

main()
  .catch((error: unknown) => {
    if (error instanceof SeedError) {
      console.error(error.message);
    } else {
      console.error('Seed failed. Check migrations and database access.', error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
