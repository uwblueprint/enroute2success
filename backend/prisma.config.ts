import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Prisma 7 does not auto-load .env. Load it next to this config file (not cwd),
// and override empty/stale shell values so `env('DATABASE_URL')` can resolve.
config({
  path: join(dirname(fileURLToPath(import.meta.url)), '.env'),
  override: true,
});

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});