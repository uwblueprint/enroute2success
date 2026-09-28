# syntax=docker/dockerfile:1
#
# Prisma ORM 7 uses pure-JS driver adapters (@prisma/adapter-pg) instead of a
# native query engine binary, so no OpenSSL/libc compat packages are needed
# here. We run TypeScript directly via `tsx` in both dev and prod (see
# package.json), so there's no separate compile stage either.

FROM node:24-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# ---------- dev: hot-reload dev server (used by docker-compose.yml) ----------
FROM base AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 4000
CMD ["npm", "run", "dev"]

# ---------- prod: runtime image ----------
FROM base AS prod
ENV NODE_ENV=production
COPY . .
# DATABASE_URL only needs to be a syntactically valid placeholder at build
# time — `prisma generate` reads the schema, it doesn't connect to a database.
# The real value is injected at container runtime (see docker-compose.yml).
ARG DATABASE_URL="postgresql://user:password@localhost:5432/db"
ENV DATABASE_URL=${DATABASE_URL}
RUN npx prisma generate
EXPOSE 4000
CMD ["npm", "run", "start"]
