# Backend development seed data

The dev seed (`src/scripts/seed.ts`) creates four synthetic accounts for manually checking the
staff-authentication ticket, then replaces all sessions with fixture data for the session-browse features.
It does not run authentication tests or create refresh tokens.

## Run the seed

The Docker backend and PostgreSQL services must already be running, the Prisma client must be generated,
and the migrations must be applied. Run these commands from the repository root:

```sh
docker compose exec backend npm run prisma:migrate:deploy
docker compose exec backend npm run db:seed
```

The seed requires `NODE_ENV=development` and a `DATABASE_URL` pointing to the `e2s_db` database on port
5432 via host `postgres`, `localhost`, or `127.0.0.1`, so it can also be run from `backend/` on the host
with `npm run db:seed`. It refuses other targets, including the `pern_db` configuration.

Prisma CLI commands preserve a nonempty runtime `DATABASE_URL`, including the URL supplied by
Docker Compose. `backend/.env` is a fallback for local CLI commands. Apply migrations to the same
database used by the backend and seed; migrations applied to another local database do not prepare
the Docker database.

### Local recovery when `students` is missing

The retained student migration drops and recreates the required staff role column, so it cannot be
applied directly to a database with existing staff rows. For a local `e2s_db` that still has
`staff_type` and no `role` enum or `students` table, this repair renames the enum without losing staff
values and creates the same Student table, index, and foreign key as the migration:

```sh
docker compose exec backend npx prisma db execute --file prisma/patches/20261027004131_preserve_staff_roles.sql && \
docker compose exec backend npx prisma migrate resolve --applied 20261027004131_student_tables_added && \
docker compose exec backend npm run prisma:migrate:deploy && \
docker compose exec backend npm run db:seed -- --auth-only --reset-auth
```

Run these commands in order and stop if one fails. `migrate resolve` records the student migration
as applied only after the equivalent repair succeeds. The remaining migrations, including setup
tokens, are then deployed normally. The original migration file and its checksum are unchanged.
The repair aborts on an unexpected database/schema state and is intended for this local recovery;
coordinate the migration-history fix before rolling the feature out to other environments.

### Migration follow-up for the merge reviewer

The local repair above is not run by `prisma migrate deploy`. The tracked
`20261027004131_student_tables_added` migration still drops and recreates the required
`staff_users.type` column and fails if staff rows already exist. This can happen even if Git merges
the branch without conflicts.

Before applying these migrations to a shared database, replace that conversion with one that preserves
the existing staff roles. Renaming `staff_type` to `role` and adding the `student` enum value preserves
the existing column and its values. Coordinate any change to this migration with databases that have
already recorded it as applied; do not delete the migration history or mark changes applied before
their equivalent schema changes are present. The tracked migration is left unchanged pending that
coordination.

## Session fixtures

Every run deletes all existing sessions and session series, then inserts one weekly series and seven
sessions relative to the current month in the org timezone: draft and cancelled sessions, several on the
same day, one near midnight on the last day of the month, and one in the previous month.

## Sample credentials

All four accounts initially use the development-only password `DevOnly!12345`.
The seed hashes each account's password separately with the application's Argon2id helper.

| Email                | GraphQL role | Primary checks                                                                   |
| -------------------- | ------------ | -------------------------------------------------------------------------------- |
| `admin@e2s.test`     | `ADMIN`      | Successful login; permitted account creation and password reset                  |
| `coach@e2s.test`     | `COACH`      | Successful login; forbidden admin operations                                     |
| `volunteer@e2s.test` | `VOLUNTEER`  | Successful login; forbidden admin operations                                     |
| `nonstaff@e2s.test`  | `STUDENT`    | Staff login returns the same generic error as an unknown email or wrong password |

The profiles use first name `Dev`, the corresponding role label as the last name, and placeholder phone
number `0000000000`. These are fixtures, not real staff accounts. Their UUIDs are fixed in the seed script.

## Rerunning and testing

The seed creates missing account fixtures in one transaction. Existing matching accounts are left unchanged,
including passwords, roles, and refresh-token sessions. If a fixture ID or email belongs to a different
account, the seed refuses to proceed and rolls back its account changes before touching sessions. It does not
delete unrelated users.

If a password-reset test changes a fixture password, rerunning the seed will not restore the original
password. Use the current password or change it with the admin password-reset mutation.

After seeding, send operations to `http://localhost:4000/graphql` using the sample credentials.
Use fresh logins to test refresh rotation, replay, expiry, logout, and session revocation. Duplicate-email
checks can reuse a seeded email; confirmation-mismatch checks need no extra fixture account.

These fixtures are for local development only. Production admin bootstrapping uses a separate process.

## Student/parent account setup

Generate the Prisma client and apply the new `add_account_setup_tokens` migration before using setup.
The request step stores a pending setup; it creates neither a User nor a student claim.

```graphql
mutation {
  requestAccountSetup(email: "parent@example.com", membershipId: 123)
}
```

Existing, unclaimed memberships receive an email containing a random setup token. Only its hash is
stored in `account_setup_tokens`, alongside the email and membership ID. Tokens expire after one hour
and can be redeemed once. Missing/claimed memberships and staff-account emails return `true` without
sending a setup email. Invalid email syntax returns `BAD_USER_INPUT`.

Set `ACCOUNT_SETUP_URL` in the backend environment to the frontend's password-setup page URL. The
backend appends the `token` query parameter. The setting is required unless `NODE_ENV=development`;
only development can fall back to `http://localhost:5173/complete-account-setup`. For another local
frontend port or path, set `ACCOUNT_SETUP_URL` explicitly. `CORS_ORIGIN` does not determine email links.

The backend validates the setup URL at startup and refuses to start if a required URL is missing,
relative, malformed, uses a protocol other than HTTP/HTTPS, or includes credentials. For example,
configure a deployed frontend's actual setup page as:

```dotenv
ACCOUNT_SETUP_URL=https://app.example.com/complete-account-setup
```

Email uses the existing `SMTP_USER`, `SMTP_PASS`, and optional `EMAIL_FROM` configuration. Without SMTP
credentials, the existing email service skips delivery. Delivery failures return the same confirmation
response.

The frontend reads the token and submits the account owner's details and password:

```graphql
mutation FinishSetup($token: String!, $password: String!) {
  completeAccountSetup(
    token: $token
    newPassword: $password
    firstName: "Alex"
    lastName: "Parent"
    phoneNumber: "555-0100"
  ) {
    accessToken
    user {
      id
      firstName
      lastName
      email
      role
    }
    managedStudents {
      membershipId
      firstName
    }
    activeStudent {
      membershipId
      firstName
    }
  }
}
```

First name, last name, and phone number must be nonblank for a new User. These GraphQL arguments are
nullable so an existing non-staff User can omit them; existing identity/contact values are preserved.
They describe the parent/account owner, not the Student profile. Password confirmation belongs to
the frontend; passwords must be nonblank.

Completion rechecks token validity, the account's eligibility, and whether the student remains
unclaimed. Token consumption, User creation/password change, student claiming, and refresh-session
creation share one transaction. Existing refresh sessions are revoked after a password change.
Success sets the refresh cookie and returns an access token with the claimed student active. Invalid,
expired, used, or no-longer-eligible links return `BAD_USER_INPUT` on `token`. New User creation is
deferred until this completion step; no placeholder names, contact details, or passwords are stored.

The frontend page and live email delivery still need integration verification.

## Link another managed student

An authenticated student/parent account can claim an unclaimed membership:

```graphql
mutation {
  linkManagedStudent(membershipId: 456) {
    accessToken
    managedStudents {
      membershipId
      firstName
    }
    activeStudent {
      membershipId
      firstName
    }
  }
}
```

The claim requires only the membership ID and succeeds only while `manager_id` is null. The response
contains all managed students in membership order and a new access token with the same User ID and
the newly linked student active. Refresh-token records and cookies are unchanged.

Missing memberships return `NOT_FOUND`; already-linked memberships return `CONFLICT`, including
memberships already managed by the caller. Anonymous requests return `UNAUTHENTICATED`, and staff
accounts return `FORBIDDEN`. No new migration is needed for this mutation.
