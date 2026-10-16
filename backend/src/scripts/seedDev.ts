import 'dotenv/config';
import { StaffType } from '../../generated/client';
import { hashPassword } from '../passwords';
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

class SeedError extends Error {}

function requireDevelopmentDatabase(): void {
  if (process.env.NODE_ENV !== 'development') {
    throw new SeedError('Dev auth seeding requires NODE_ENV=development.');
  }

  let target: URL;
  try {
    target = new URL(process.env.DATABASE_URL ?? '');
  } catch {
    throw new SeedError('Dev auth seeding requires a valid development DATABASE_URL.');
  }

  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    target.hostname !== 'postgres' ||
    (target.port || '5432') !== '5432' ||
    target.pathname !== '/e2s_db'
  ) {
    throw new SeedError('Dev auth seeding only supports the Docker database postgres:5432/e2s_db.');
  }
}

async function main(): Promise<void> {
  requireDevelopmentDatabase();

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
              'A seed ID or email belongs to another account; seeding was rolled back.'
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

  console.log(`Created ${created} dev auth accounts in e2s_db; existing accounts were unchanged.`);
}

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof SeedError
        ? error.message
        : 'Dev auth seeding failed. Check migrations and database access; no account changes were committed.'
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
