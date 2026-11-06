/**
 * Dev-only seed for auth, session-calendar, and feedback fixtures.
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
 * Students: creates two fixtures managed by the nonstaff account. Refuses
 * conflicting membership IDs and preserves existing matching students.
 * Feedback, sessions, and series: replaces all rows in one transaction.
 * Fixture coverage (maps to the testing checklist):
 *  - Sessions with AND without `max_attendees`.
 *  - One `draft` and one `cancelled` session.
 *  - Two sessions on the SAME local day.
 *  - One near midnight on the LAST day of a month (timezone edge case).
 *  - One in a PAST month.
 *  - One belonging to a `session_series`, and one one-off (null series).
 *  - Feedback for two students, with different staff authors.
 *  - Sessions today, 7 days ago, 8 days ago, tomorrow, and an empty session.
 */
import 'dotenv/config';
import { Role } from '../../generated/client';
import type { Prisma, session_status, session_type } from '../../generated/client';
import { ORG_TIMEZONE, zonedWallTimeToUtc, currentLocalMonthYear } from '../utils/datetime';
import { hashPassword } from '../utils/passwords';
import { prisma } from '../prisma';

const DEV_PASSWORD = 'DevOnly!12345';
const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const COACH_ID = '00000000-0000-4000-8000-000000000002';
const STUDENT_MANAGER_ID = '00000000-0000-4000-8000-000000000004';
const FEEDBACK_TIMEZONE = 'America/Toronto';

const students = [
  { membership_id: 990001, first_name: 'Dev', last_name: 'Feedback A' },
  { membership_id: 990002, first_name: 'Dev', last_name: 'Feedback B' },
];

const accounts = [
  {
    id: ADMIN_ID,
    email: 'admin@e2s.test',
    lastName: 'Admin',
    role: Role.ADMIN,
  },
  {
    id: COACH_ID,
    email: 'coach@e2s.test',
    lastName: 'Coach',
    role: Role.COACH,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    email: 'volunteer@e2s.test',
    lastName: 'Volunteer',
    role: Role.VOLUNTEER,
  },
  {
    id: STUDENT_MANAGER_ID,
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
            ...(account.role === null ? {} : { staff: { create: { role: account.role } } }),
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

async function seedStudents(tx: Prisma.TransactionClient): Promise<void> {
  for (const student of students) {
    const existing = await tx.student.findUnique({
      where: { membership_id: student.membership_id },
      select: { manager_id: true, first_name: true, last_name: true },
    });

    if (existing) {
      if (
        existing.manager_id !== STUDENT_MANAGER_ID ||
        existing.first_name !== student.first_name ||
        existing.last_name !== student.last_name
      ) {
        throw new SeedError(`Student fixture ID ${student.membership_id} is already in use.`);
      }

      continue;
    }

    await tx.student.create({
      data: {
        ...student,
        manager_id: STUDENT_MANAGER_ID,
        allergies: [],
        birth_date: new Date('2010-01-01T00:00:00.000Z'),
      },
    });
  }
}

/** Build a UTC Date from local wall-clock parts in the ORG timezone. */
function local(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  // zonedWallTimeToUtc resolves local midnight; add the intra-day offset.
  const midnightUtc = zonedWallTimeToUtc(year, month, day);
  return new Date(midnightUtc.getTime() + (hour * 60 + minute) * 60000);
}

async function seedSessions(tx: Prisma.TransactionClient): Promise<void> {
  const { month, year } = currentLocalMonthYear();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevMonthYear = month === 1 ? year - 1 : year;
  // Last day of the CURRENT local month (day 0 of next month = last day of this one).
  const lastDay = new Date(year, month, 0).getDate();

  console.log(
    `🌱 Seeding sessions for local timezone ${ORG_TIMEZONE}. ` +
      `Current local month: ${year}-${String(month).padStart(2, '0')}.`
  );

  // ---- A recurring series that one session will belong to ----
  const series = await tx.session_series.create({
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

  await tx.session.createMany({ data: sessions });

  const total = await tx.session.count();
  console.log(`✅ Seeded ${total} calendar sessions (+1 session_series).`);
  console.log(
    `   • Current month (${year}-${String(month).padStart(2, '0')}): ` +
      `${sessions.filter((s) => s.start_datetime >= zonedWallTimeToUtc(year, month, 1) && s.start_datetime < zonedWallTimeToUtc(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1)).length} sessions ` +
      `(incl. 1 draft, 1 cancelled, a near-midnight edge case, and same-day sessions).`
  );
  console.log(
    `   • Past month (${prevMonthYear}-${String(prevMonth).padStart(2, '0')}): 1 session.`
  );
}

async function seedFeedback(tx: Prisma.TransactionClient): Promise<void> {
  const sessionIds = {
    today: '10000000-0000-4000-8000-000000000001',
    day7: '10000000-0000-4000-8000-000000000002',
    day8: '10000000-0000-4000-8000-000000000003',
    future: '10000000-0000-4000-8000-000000000004',
    empty: '10000000-0000-4000-8000-000000000005',
  };
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FEEDBACK_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const sessionFixtures = [
    { id: sessionIds.today, label: 'Today', daysAgo: 0 },
    { id: sessionIds.day7, label: 'Day 7', daysAgo: 7 },
    { id: sessionIds.day8, label: 'Day 8', daysAgo: 8 },
    { id: sessionIds.future, label: 'Future', daysAgo: -1 },
    { id: sessionIds.empty, label: 'Today (empty)', daysAgo: 0 },
  ];

  await tx.session.createMany({
    data: sessionFixtures.map<Prisma.sessionCreateManyInput>((fixture) => ({
      id: fixture.id,
      name: `[Feedback] ${fixture.label}`,
      status: 'scheduled',
      session_type: 'chess',
      start_datetime: zonedWallTimeToUtc(year, month, day - fixture.daysAgo, FEEDBACK_TIMEZONE),
      end_datetime: zonedWallTimeToUtc(year, month, day - fixture.daysAgo + 1, FEEDBACK_TIMEZONE),
      image_urls: [],
    })),
  });

  const feedbackFixtures = [
    {
      id: '20000000-0000-4000-8000-000000000001',
      receiver: 990001,
      session_id: sessionIds.today,
      giver: COACH_ID,
      text: 'Seed: student A / today',
    },
    {
      id: '20000000-0000-4000-8000-000000000002',
      receiver: 990002,
      session_id: sessionIds.today,
      giver: ADMIN_ID,
      text: 'Seed: student B / today',
    },
    {
      id: '20000000-0000-4000-8000-000000000003',
      receiver: 990001,
      session_id: sessionIds.day7,
      giver: COACH_ID,
      text: 'Seed: student A / day 7',
    },
    {
      id: '20000000-0000-4000-8000-000000000004',
      receiver: 990001,
      session_id: sessionIds.day8,
      giver: ADMIN_ID,
      text: 'Seed: student A / day 8',
    },
    {
      id: '20000000-0000-4000-8000-000000000005',
      receiver: 990001,
      session_id: sessionIds.future,
      giver: ADMIN_ID,
      text: 'Seed: student A / future',
    },
  ];

  await tx.feedback.createMany({
    data: feedbackFixtures.map((feedback, index) => {
      const createdAt = new Date(now.getTime() - (feedbackFixtures.length - index) * 60_000);
      return {
        ...feedback,
        updated_by: feedback.giver,
        created_at: createdAt,
        updated_at: createdAt,
      };
    }),
  });
}

async function main(): Promise<void> {
  requireDevelopmentDatabase();
  await seedStaffAccounts();
  await prisma.$transaction(
    async (tx) => {
      await seedStudents(tx);
      // Feedback must be removed before sessions because its FK uses Restrict.
      await tx.feedback.deleteMany({});
      await tx.session.deleteMany({});
      await tx.session_series.deleteMany({});
      await seedSessions(tx);
      await seedFeedback(tx);
    },
    { timeout: 15_000 }
  );
  console.log(
    '✅ Feedback fixtures ready: students 990001/990002, 5 sessions, and 5 feedback entries.'
  );
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
