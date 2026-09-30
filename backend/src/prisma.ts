import 'dotenv/config';
import { PrismaClient } from '../generated/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma ORM 7 requires a driver adapter — there is no built-in query engine.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

// Reuse a single PrismaClient instance (recommended by Prisma docs to avoid
// exhausting database connections, especially with hot-reload in dev).
declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma = global.__prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV === 'development') {
  global.__prisma = prisma;
}
