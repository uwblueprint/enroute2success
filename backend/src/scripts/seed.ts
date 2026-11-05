/**
 * Dev-only seed for staff, parent/student authentication, and sessions.
 *
 * ⚠️  NOT FOR PRODUCTION. It requires NODE_ENV=development and a DATABASE_URL
 * pointing at the local e2s_db database.
 *
 * Run with: npm run db:seed, or npm run db:seed -- --auth-only to keep sessions.
 * Add --reset-auth to restore fixture passwords and initial student ownership.
 *
 * Auth fixtures: creates missing accounts and Student profiles. Existing
 * passwords, contact details, and student ownership are preserved. Conflicting
 * fixture identities or roles roll back all auth changes. Fresh development
 * setup tokens are printed only after their transaction commits. --reset-auth
 * clears fixture refresh/setup tokens and removes the completed new-User setup
 * account so that setup case can be repeated.
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
import { Role } from '../../generated/client';
import type { session_status, session_type } from '../../generated/client';
import { ORG_TIMEZONE, zonedWallTimeToUtc, currentLocalMonthYear } from '../utils/datetime';
import { hashPassword } from '../utils/passwords';
import {
  generateAccountSetupToken,
  getAccountSetupTokenExpiry,
  getAccountSetupUrl,
  hashAccountSetupToken,
} from '../utils/accountSetupTokens';
import { prisma } from '../prisma';

const DEV_PASSWORD = 'DevOnly!12345';
const MULTI_PARENT_ID = '00000000-0000-4000-8000-000000000005';
const SINGLE_PARENT_ID = '00000000-0000-4000-8000-000000000006';
const SELF_MANAGED_ID = '00000000-0000-4000-8000-000000000007';
const STUDENT_FIXTURE_NOTE = 'Synthetic development auth fixture; not a real participant.';
const STUDENT_BIRTH_DATE = new Date('2015-06-07T00:00:00.000Z');

const accounts = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'admin@e2s.test',
    lastName: 'Admin',
    role: Role.ADMIN,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
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
    id: '00000000-0000-4000-8000-000000000004',
    email: 'nonstaff@e2s.test',
    lastName: 'Nonstaff',
    role: null,
  },
  {
    id: MULTI_PARENT_ID,
    email: 'parent.multi@e2s.test',
    lastName: 'MultiParent',
    role: null,
  },
  {
    id: SINGLE_PARENT_ID,
    email: 'parent.single@e2s.test',
    lastName: 'SingleParent',
    role: null,
  },
  {
    id: SELF_MANAGED_ID,
    email: 'student@e2s.test',
    lastName: 'SelfManaged',
    role: null,
  },
];

const students = [
  { membershipId: 900001, firstName: 'Dev Sibling One', managerId: MULTI_PARENT_ID },
  { membershipId: 900002, firstName: 'Dev Sibling Two', managerId: MULTI_PARENT_ID },
  { membershipId: 900003, firstName: 'Dev Only Child', managerId: SINGLE_PARENT_ID },
  { membershipId: 900004, firstName: 'Dev Self Managed', managerId: SELF_MANAGED_ID },
  { membershipId: 900005, firstName: 'Dev New Setup', managerId: null },
  { membershipId: 900006, firstName: 'Dev Link Student', managerId: null },
  { membershipId: 900007, firstName: 'Dev Existing Setup', managerId: null },
  { membershipId: 900008, firstName: 'Dev Email Request', managerId: null },
];

const setupCases = [
  {
    label: 'New User setup',
    email: 'setup.new@e2s.test',
    membershipId: 900005,
    userId: null,
    state: 'valid',
  },
  {
    label: 'Existing parent setup',
    email: 'parent.multi@e2s.test',
    membershipId: 900007,
    userId: MULTI_PARENT_ID,
    state: 'valid',
  },
  {
    label: 'Expired setup token',
    email: 'setup.expired@e2s.test',
    membershipId: 900008,
    userId: null,
    state: 'expired',
  },
  {
    label: 'Already-used setup token',
    email: 'setup.used@e2s.test',
    membershipId: 900008,
    userId: null,
    state: 'used',
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

async function seedAuthFixtures(resetAuth: boolean): Promise<void> {
  const preparedAccounts = await Promise.all(
    accounts.map(async (account) => ({
      ...account,
      passwordHash: await hashPassword(DEV_PASSWORD),
    }))
  );

  const seeded = await prisma.$transaction(
    async (tx) => {
      let accountCount = 0;
      let studentCount = 0;
      let resetAccountCount = 0;
      let resetStudentCount = 0;
      let removedSetupUsers = 0;
      const setupLinks: {
        label: string;
        email: string;
        membershipId: number;
        token: string;
        url: string;
      }[] = [];
      const skippedSetups: string[] = [];

      for (const account of preparedAccounts) {
        const existing = await tx.user.findFirst({
          where: { OR: [{ id: account.id }, { email: account.email }] },
          select: { id: true, email: true, staff: { select: { role: true } } },
        });

        if (existing) {
          if (existing.id !== account.id || existing.email !== account.email) {
            throw new SeedError(
              'A seed ID or email belongs to another account; account seeding was rolled back.'
            );
          }

          if ((existing.staff?.role ?? null) !== account.role) {
            throw new SeedError(
              'A fixture account has a different role; auth seeding was rolled back without changing roles.'
            );
          }

          if (resetAuth) {
            await tx.user.update({
              where: { id: account.id },
              data: { password_hash: account.passwordHash },
            });
            await tx.refresh_tokens.deleteMany({ where: { user_id: account.id } });
            resetAccountCount += 1;
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
        accountCount += 1;
      }

      for (const student of students) {
        const existing = await tx.student.findUnique({
          where: { membership_id: student.membershipId },
        });

        if (existing) {
          if (
            existing.first_name !== student.firstName ||
            existing.last_name !== 'Fixture' ||
            existing.birth_date.getTime() !== STUDENT_BIRTH_DATE.getTime() ||
            existing.notes !== STUDENT_FIXTURE_NOTE
          ) {
            throw new SeedError(
              'A fixture membership ID belongs to another student; auth seeding was rolled back.'
            );
          }

          if (resetAuth) {
            await tx.student.update({
              where: { membership_id: student.membershipId },
              data: { manager_id: student.managerId },
            });
            resetStudentCount += 1;
          }

          continue;
        }

        await tx.student.create({
          data: {
            membership_id: student.membershipId,
            manager_id: student.managerId,
            first_name: student.firstName,
            last_name: 'Fixture',
            preferred_name: student.membershipId === 900002 ? 'Dev Two' : null,
            birth_date: STUDENT_BIRTH_DATE,
            points: student.membershipId === 900001 ? 25 : 0,
            allergies: [],
            notes: STUDENT_FIXTURE_NOTE,
          },
        });
        studentCount += 1;
      }

      if (resetAuth) {
        const membershipIds = students.map((student) => student.membershipId);
        await tx.accountSetupToken.deleteMany({
          where: { membership_id: { in: membershipIds } },
        });

        for (const setup of setupCases.filter(
          (candidate) => candidate.state === 'valid' && candidate.userId === null
        )) {
          const owner = await tx.user.findUnique({
            where: { email: setup.email },
            include: {
              staff: true,
              students: { select: { membership_id: true } },
              announcements: { select: { id: true }, take: 1 },
              accountSetupTokens: { select: { membership_id: true } },
            },
          });

          if (!owner) {
            continue;
          }

          if (
            owner.staff !== null ||
            owner.students.some((student) => !membershipIds.includes(student.membership_id)) ||
            owner.announcements.length > 0 ||
            owner.accountSetupTokens.some((token) => !membershipIds.includes(token.membership_id))
          ) {
            throw new SeedError(
              'The new-User setup fixture has unrelated data or a staff role; auth reset was rolled back.'
            );
          }

          await tx.refresh_tokens.deleteMany({ where: { user_id: owner.id } });
          await tx.user.delete({ where: { id: owner.id } });
          removedSetupUsers += 1;
        }
      }

      for (const setup of setupCases) {
        const student = await tx.student.findUnique({
          where: { membership_id: setup.membershipId },
        });

        if (!student || student.manager_id !== null) {
          skippedSetups.push(
            `${setup.label}: membership ${setup.membershipId} is already claimed.`
          );
          continue;
        }

        const owner = await tx.user.findUnique({ where: { email: setup.email } });

        if ((owner?.id ?? null) !== setup.userId) {
          skippedSetups.push(`${setup.label}: the setup email no longer matches the fixture case.`);
          continue;
        }

        const rawToken = generateAccountSetupToken();
        const url = getAccountSetupUrl(rawToken);

        await tx.accountSetupToken.create({
          data: {
            email: setup.email,
            membership_id: setup.membershipId,
            user_id: setup.userId,
            token_hash: hashAccountSetupToken(rawToken),
            expires_at:
              setup.state === 'expired'
                ? new Date(Date.now() - 1000)
                : getAccountSetupTokenExpiry(),
            used_at: setup.state === 'used' ? new Date() : null,
          },
        });
        setupLinks.push({
          label: setup.label,
          email: setup.email,
          membershipId: setup.membershipId,
          token: rawToken,
          url,
        });
      }

      return {
        accountCount,
        studentCount,
        resetAccountCount,
        resetStudentCount,
        removedSetupUsers,
        setupLinks,
        skippedSetups,
      };
    },
    { isolationLevel: 'ReadCommitted' }
  );

  console.log(
    `✅ Created ${seeded.accountCount} dev auth accounts and ${seeded.studentCount} students.`
  );

  if (resetAuth) {
    console.log(
      `Reset ${seeded.resetAccountCount} fixture passwords to ${DEV_PASSWORD} and restored ` +
        `${seeded.resetStudentCount} student assignments. Cleared fixture refresh/setup tokens ` +
        `and removed ${seeded.removedSetupUsers} completed new-User setup accounts.`
    );
  } else {
    console.log('Existing passwords, contact details, and claims were unchanged.');
  }
  console.table(
    accounts.map((account) => ({
      email: account.email,
      role: account.role ?? Role.STUDENT,
      initialPassword: DEV_PASSWORD,
    }))
  );
  console.table(
    students.map((student) => ({
      membershipId: student.membershipId,
      student: student.firstName,
      initialManager:
        accounts.find((account) => account.id === student.managerId)?.email ?? 'Unclaimed',
    }))
  );

  for (const setup of seeded.setupLinks) {
    console.log(`\n${setup.label} (${setup.email}, membership ${setup.membershipId})`);
    console.log(`  Token: ${setup.token}`);
    console.log(`  URL: ${setup.url}`);
  }

  for (const skipped of seeded.skippedSetups) {
    console.log(`Skipped ${skipped}`);
  }

  console.log('\nValid development setup tokens expire after one hour. No emails were sent.');
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

async function main(): Promise<void> {
  requireDevelopmentDatabase();
  const args = process.argv.slice(2);

  if (args.some((arg) => !['--auth-only', '--reset-auth'].includes(arg))) {
    throw new SeedError('Supported seed options: --auth-only, --reset-auth.');
  }

  await seedAuthFixtures(args.includes('--reset-auth'));

  if (args.includes('--auth-only')) {
    console.log('Auth-only seed complete; sessions and session series were unchanged.');
  } else {
    await seedSessions();
  }
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
