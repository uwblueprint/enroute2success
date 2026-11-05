import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep an explicit runtime URL, especially Docker's postgres hostname/database.
// Local CLI commands fall back to the .env next to this config file (not cwd).
if (process.env.DATABASE_URL?.trim() === '') {
  delete process.env.DATABASE_URL;
}

config({
  path: join(dirname(fileURLToPath(import.meta.url)), '.env'),
  override: false,
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
