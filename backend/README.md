# Backend development authentication accounts

The dev seed creates four synthetic accounts for manually checking the staff-authentication ticket.
It does not run authentication tests or create refresh tokens.

## Run the seed

The Docker backend and PostgreSQL services must already be running, the Prisma client must be generated,
and the authentication migration must be applied. Run these commands from the repository root:

```sh
docker compose exec backend npm run prisma:migrate:deploy
docker compose exec backend npm run seed:dev
```

The seed requires `NODE_ENV=development` and a `DATABASE_URL` pointing to `postgres:5432/e2s_db`.
It refuses other targets, including the host-side `pern_db` configuration. It reuses the running backend's
connection settings and does not require database credentials on the command line.

## Sample credentials

All four accounts initially use the development-only password `DevOnly!12345`.
The seed hashes each account's password separately with the application's Argon2id helper.

| Email                | GraphQL role | Primary checks                                                                   |
| -------------------- | ------------ | -------------------------------------------------------------------------------- |
| `admin@e2s.test`     | `ADMIN`      | Successful login; permitted account creation and password reset                  |
| `coach@e2s.test`     | `COACH`      | Successful login; forbidden admin operations                                     |
| `volunteer@e2s.test` | `VOLUNTEER`  | Successful login; forbidden admin operations                                     |
| `nonstaff@e2s.test`  | None         | Staff login returns the same generic error as an unknown email or wrong password |

The profiles use first name `Dev`, the corresponding role label as the last name, and placeholder phone
number `0000000000`. These are fixtures, not real staff accounts. Their UUIDs are fixed in the seed script.

## Rerunning and testing

The seed creates missing fixtures in one transaction. Existing matching fixtures are left unchanged,
including passwords, roles, and sessions. If a fixture ID or email belongs to a different account, the
seed refuses to proceed and rolls back its changes. It does not delete unrelated records.

If a password-reset test changes a fixture password, rerunning the seed will not restore the original
password. Use the current password or change it with the admin password-reset mutation.

After seeding, send operations to `http://localhost:4000/graphql` using the sample credentials.
Use fresh logins to test refresh rotation, replay, expiry, logout, and session revocation. Duplicate-email
checks can reuse a seeded email; confirmation-mismatch checks need no extra fixture account.

These fixtures are for local development only. Production admin bootstrapping uses a separate process.
