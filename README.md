# PERN Stack Scaffold

A bare-bones **P**ostgreSQL + **E**xpress + **R**eact + **N**ode application, wired
together with GraphQL.

```
enroute2success/
├── backend/     Express + Apollo Server (GraphQL) + Prisma ORM + PostgreSQL
├── frontend/    React + Vite + Apollo Client
├── docker-compose.yml
└── .env.example
```

## Stack

| Layer      | Tech |
|------------|------|
| Database   | PostgreSQL 18 |
| ORM        | Prisma ORM 7 (`@prisma/adapter-pg` driver adapter) |
| API        | Express 5 + Apollo Server 5 (GraphQL), served at `/graphql` |
| Frontend   | React 19 + Vite + Apollo Client 4 |
| Language   | TypeScript everywhere |
| Containers | Docker + Docker Compose (local dev; backend also has a prod image) |

This is a **bare scaffold**: there's no sample data model yet, just a `health`
GraphQL query that confirms the whole chain (React → Apollo Client → Express →
Apollo Server → Prisma → Postgres) is wired up correctly. Add your own Prisma
models and GraphQL types/resolvers to build on top of it.

---

## Prerequisites

You have two ways to run this app: **Docker** (recommended, zero local setup)
or **running everything natively** on your machine. Pick one.

### Option A — Docker (recommended)

- [Docker Engine](https://docs.docker.com/engine/install/) 24+
- [Docker Compose](https://docs.docker.com/compose/install/) v2 (bundled with
  Docker Desktop, or `docker-compose-plugin` on Linux)

That's it — Node, PostgreSQL, and every dependency run inside containers.

### Option B — Running natively (no Docker)

- [Node.js](https://nodejs.org/) **v20.19+** (Node 24 LTS recommended — this
  project uses ESM-only tooling: Prisma 7, `tsx`, Vite)
- npm (ships with Node)
- A running [PostgreSQL](https://www.postgresql.org/download/) 14+ instance
  you can connect to (local install, or `docker run postgres:18-alpine`)

Check your Node version:

```bash
node -v   # should print v20.19.0 or higher
```

---

## Quick Start (Docker)

1. **Copy the root env file** — Docker Compose reads this to configure
   Postgres, and to pass matching values into the backend/frontend containers:

   ```bash
   cp .env.example .env
   ```

   The defaults work out of the box; edit `.env` if you want different ports
   or credentials.

2. **Build and start everything:**

   ```bash
   docker compose up --build
   ```

   This starts three containers:
   - `postgres` — PostgreSQL 18, with a persisted named volume
   - `backend` — Express/Apollo GraphQL API on hot-reload (`tsx watch`),
     runs `npx prisma generate` on startup
   - `frontend` — Vite dev server with HMR

3. **Open the app:**
   - Frontend: <http://localhost:5173> — you should see a status card confirming
     the GraphQL server and database are reachable.
   - GraphQL API / Apollo sandbox: <http://localhost:4000/graphql>
   - REST health check: <http://localhost:4000/healthz>

4. **Stop everything:**

   ```bash
   docker compose down
   ```

   Add `-v` to also delete the Postgres data volume (full reset):

   ```bash
   docker compose down -v
   ```

### Building a production backend image

The backend Dockerfile has a `prod` stage in addition to the `dev` stage:

```bash
docker build --target prod -t pern-backend:prod ./backend
```

The frontend has no production image on purpose — see
[Deployment](#deployment) below.

---

## Quick Start (native, no Docker)

1. **Start Postgres** (however you like — local install, Homebrew, or a lone
   container: `docker run --name pg -e POSTGRES_PASSWORD=pern_password -e POSTGRES_USER=pern_user -e POSTGRES_DB=pern_db -p 5432:5432 -d postgres:18-alpine`).

2. **Backend setup:**

   ```bash
   cd backend
   cp .env.example .env      # adjust DATABASE_URL if needed
   npm install
   npm run prisma:generate   # generates the Prisma Client into backend/generated
   npm run dev                # starts the API on http://localhost:4000
   ```

3. **Frontend setup** (in a second terminal):

   ```bash
   cd frontend
   cp .env.example .env      # points at http://localhost:4000/graphql by default
   npm install
   npm run dev                # starts Vite on http://localhost:5173
   ```

4. Open <http://localhost:5173>.

---

## Adding your first data model

1. Edit `backend/prisma/schema.prisma` and add a `model` block (see the
   commented example already in the file, and the conventions noted above it:
   both sides of relations via `@relation`, `createdAt`/`updatedAt`
   timestamps, `@@index` on frequently queried fields, etc).
2. Create and apply a migration:

   ```bash
   cd backend
   npm run prisma:migrate -- --name init
   npm run prisma:generate
   ```

3. Extend `backend/src/schema/typeDefs.ts` and `resolvers.ts` with GraphQL
   types/queries/mutations that use `ctx.prisma.<yourModel>`.
4. Query it from the frontend with `useQuery`/`useMutation` from
   `@apollo/client/react` (see `frontend/src/App.tsx` for the pattern).

## Deployment

The two halves deploy differently:

**Frontend → a static host** (Vercel, Netlify, Cloudflare Pages). These run
`npm run build` and serve `dist/` themselves, so there's no Docker image or
server involved. Two things to configure on whichever host you pick:

- Set `VITE_GRAPHQL_URL` as a **build-time** environment variable pointing at
  your deployed API. Vite inlines `VITE_*` variables into the bundle at build
  time, so changing it later requires a rebuild, not just a restart.
- Add an SPA fallback rewrite so deep links and refreshes don't 404 once you
  add client-side routing — `vercel.json` rewrites on Vercel, `netlify.toml`
  or `_redirects` on Netlify, `_redirects` on Cloudflare Pages. All of them
  rewrite unmatched paths to `/index.html`.

**Backend → a host that runs long-lived processes** (Render, Railway, Fly.io,
or any container platform), with managed Postgres (Neon, Supabase, RDS, etc.)
behind it. It's a persistent Express server holding a connection pool, so it
doesn't fit the static/serverless model of the frontend hosts above. Set
`DATABASE_URL`, `PORT`, and `CORS_ORIGIN` (your deployed frontend's origin —
otherwise the browser will block API calls) in that host's environment, and
run `npm run prisma:migrate:deploy` as part of your release step.

## Useful backend scripts

Run from `backend/`:

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start the API with hot-reload (`tsx watch`) |
| `npm run start` | Start the API without watch (used in the prod image) |
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm run prisma:generate` | Regenerate the Prisma Client after schema changes |
| `npm run prisma:migrate` | Create + apply a dev migration |
| `npm run prisma:migrate:deploy` | Apply pending migrations (CI/production) |
| `npm run prisma:studio` | Open Prisma Studio to browse your database |

## Notes on the stack

- **Prisma ORM 7** no longer ships a native query engine binary — it uses the
  pure-JS `@prisma/adapter-pg` driver adapter instead (backed by `pg`). This
  means no OpenSSL/glibc gymnastics in the Docker images, and the generated
  client lives in `backend/generated/` (not `node_modules/@prisma/client`) —
  imported as `from "../generated/client"`.
- **Apollo Client 4** moved all React-specific exports (`ApolloProvider`,
  `useQuery`, `useMutation`, etc.) to `@apollo/client/react`. Core exports
  (`ApolloClient`, `InMemoryCache`, `gql`) remain in `@apollo/client`.
- The backend runs TypeScript directly via [`tsx`](https://tsx.is/) in both
  dev and prod — there's no `tsc`-compiled `dist/` folder to manage.

## Troubleshooting

- **`backend` container keeps restarting / can't reach database** — make sure
  `docker compose up` includes the `postgres` service and that you didn't
  change `POSTGRES_*` in `.env` without rebuilding (`docker compose up --build`).
- **Frontend shows "Could not reach the GraphQL API"** — check that
  `VITE_GRAPHQL_URL` in `.env` matches the backend's exposed port, and that
  the backend container is healthy (`docker compose logs backend`).
- **Port already in use** — change `BACKEND_PORT`, `FRONTEND_PORT`, or
  `POSTGRES_PORT` in `.env`, then `docker compose up --build`.
