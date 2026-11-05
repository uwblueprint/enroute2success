# Backend development seed data

The dev seed (`src/scripts/seed.ts`) creates synthetic staff accounts, parent/self-managed User
accounts, Student profiles, and development setup tokens for manual authentication checks. By default
it also replaces sessions with fixture data for the session-browse features. It does not run tests,
send email, or create refresh tokens; logins and account completion create refresh sessions normally.

## Run the seed

The Docker backend and PostgreSQL services must already be running, the Prisma client must be generated,
and the migrations must be applied. Run these commands from the repository root:

```sh
docker compose exec backend npm run prisma:migrate:deploy
docker compose exec backend npm run db:seed -- --auth-only
```

`--auth-only` leaves sessions and session series untouched. Omit it to also replace session fixtures,
as the original script did. Apply migrations and generate the Prisma client before seeding. Review
the existing staff-role migration before applying the migration history to a populated database.

To restore forgotten fixture passwords and repeat the signup/linking cases, run:

```sh
docker compose exec backend npm run db:seed -- --auth-only --reset-auth
```

`--reset-auth` restores all seven seeded account passwords to `DevOnly!12345`, clears their refresh
sessions, restores the eight fixture students' initial manager assignments, clears setup tokens for
those membership IDs, and prints fresh setup tokens. It also removes the completed
`setup.new@e2s.test` account so that the new-account setup case can be repeated. Account contact
details and Student profile fields are preserved. Session/session-series fixtures remain unchanged
when paired with `--auth-only`.

The reset is limited to these reserved auth fixtures. Other accounts and nonfixture students are
preserved. If the new-User setup account has a staff role, announcements, nonfixture students, or
setup tokens for nonfixture memberships, the reset rolls back rather than deleting that data.

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

A full seed (without `--auth-only`) deletes all existing sessions and session series, then inserts one weekly series and seven
sessions relative to the current month in the org timezone: draft and cancelled sessions, several on the
same day, one near midnight on the last day of the month, and one in the previous month.

## Sample credentials

All seven seeded login accounts initially use the development-only password `DevOnly!12345`.
The seed hashes each account's password separately with the application's Argon2id helper.

| Email                    | GraphQL role | Primary checks                                                                   |
| ------------------------ | ------------ | -------------------------------------------------------------------------------- |
| `admin@e2s.test`         | `ADMIN`      | Successful login; permitted account creation and password reset                  |
| `coach@e2s.test`         | `COACH`      | Successful login; forbidden admin operations                                     |
| `volunteer@e2s.test`     | `VOLUNTEER`  | Successful login; forbidden admin operations                                     |
| `nonstaff@e2s.test`      | `STUDENT`    | Staff login returns the same generic error as an unknown email or wrong password |
| `parent.multi@e2s.test`  | `STUDENT`    | Manages two students; email login returns a profile picker                       |
| `parent.single@e2s.test` | `STUDENT`    | Manages one student; email login selects that student                            |
| `student@e2s.test`       | `STUDENT`    | Self-managed student; email and membership login select their profile            |

The profiles use first name `Dev`, the corresponding role label as the last name, and placeholder phone
number `0000000000`. These are synthetic accounts. Their UUIDs are fixed in the seed script.

The three new User IDs end in `0005` (multi-parent), `0006` (single-parent), and `0007` (self-managed).
The original nonstaff User ID ends in `0004` and initially has no students.

## Student fixtures

These are the initial assignments. Existing claims are preserved on ordinary reruns; `--reset-auth`
restores the assignments below.

| Membership ID | Initial manager          | Purpose                                                    |
| ------------- | ------------------------ | ---------------------------------------------------------- |
| `900001`      | `parent.multi@e2s.test`  | First family profile; 25 points                            |
| `900002`      | `parent.multi@e2s.test`  | Second family profile; preferred name `Dev Two`            |
| `900003`      | `parent.single@e2s.test` | Single-profile login; foreign profile for the multi-parent |
| `900004`      | `student@e2s.test`       | Self-managed student login                                 |
| `900005`      | Unclaimed                | Complete setup for a new `setup.new@e2s.test` User         |
| `900006`      | Unclaimed                | Link another student to an existing account                |
| `900007`      | Unclaimed                | Complete setup for the existing multi-parent               |
| `900008`      | Unclaimed                | Actual email requests and expired/used-token checks        |

Each Student has a synthetic identity marker. If a reserved membership ID belongs to another
student, the script rolls back all auth fixtures rather than replacing or claiming that profile.

## Development setup tokens

The seed prints tokens and URLs for **new User setup**, **existing parent setup**, **expired setup**,
and **already-used setup**. They exercise completion without SMTP or a frontend page: copy the token
into `completeAccountSetup` below. Only token hashes are stored. Valid tokens expire after one hour; a rerun
creates fresh tokens for cases whose students are still unclaimed and whose email matches the case.
Ordinary reruns never revive consumed tokens or unclaim a student. `--reset-auth` clears old fixture
tokens and restores initial ownership before generating new tokens.

`setup.new@e2s.test` is deliberately not created as a User by the seed. Complete its setup with
first name, last name, and phone number to test new account creation. The existing-parent case uses
`parent.multi@e2s.test` and allows those details to be omitted. Expired and already-used tokens should
return `BAD_USER_INPUT` on `token` and make no account/password/ownership changes.

These synthetic addresses do not receive real email. To verify actual delivery, use your own email
with `requestAccountSetup` and membership `900008`, with SMTP configured. A seeded token is a completion
fixture; it does not verify email delivery by `requestAccountSetup`.

## Rerunning and testing

The seed creates missing account/Student fixtures and setup tokens in one transaction. Existing
matching accounts are left unchanged, including passwords, contact details, and refresh sessions.
Existing Student profiles and their ownership are preserved. A conflicting account ID, email, role,
or Student identity rolls back all auth changes before touching sessions. Unrelated users are not
deleted. An already-claimed setup case is skipped rather than reset.

If a password-changing test changes a fixture password, an ordinary rerun preserves it. Use
`--auth-only --reset-auth` to restore the seeded passwords, or use the admin password-reset mutation
to change one account's password.

After seeding, send operations to `http://localhost:4000/graphql` using the sample credentials.
Use fresh logins to test refresh rotation, replay, expiry, logout, and session revocation. Duplicate-email
checks can reuse a seeded email; confirmation-mismatch checks need no extra fixture account.

These fixtures are for local development only. Production admin bootstrapping uses a separate process.

## Manual authentication checklist

Use your GraphQL client to run the mutations and queries listed below. Run initial login/profile
checks before consuming unclaimed fixtures. Use `http://localhost:4000/graphql` and the password
above unless you changed it.

For `loginStudent`, provide variables such as:

```json
{ "input": { "email": "parent.multi@e2s.test", "password": "DevOnly!12345" } }
```

or:

```json
{ "input": { "membershipId": 900001, "password": "DevOnly!12345" } }
```

After login, set `Authorization: Bearer <accessToken>` for protected operations. Replace that token
after switching/linking. Retain the response's `refresh_token` cookie for refresh/logout. If your API
client does not retain cookies, copy that cookie from `Set-Cookie` into a `Cookie` request header.
Login, setup, refresh, and logout do not require an Authorization header; remove an expired Bearer
token before these requests so context validation does not reject the request first.

| Check                       | Operation and expected result                                                                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff access                | `loginStaff` for admin/coach/volunteer returns the matching role, no managed students, and no active student.                                                                                                                     |
| Portal restrictions         | Staff credentials through `loginStudent`, or nonstaff/parent/student credentials through `loginStaff`, return `UNAUTHENTICATED`.                                                                                                  |
| Password/input failures     | Wrong passwords return `UNAUTHENTICATED`. Both or neither login identifier returns `BAD_USER_INPUT`.                                                                                                                              |
| Zero profiles               | Email login for `nonstaff@e2s.test` succeeds with an empty list and null active student.                                                                                                                                          |
| Multiple profiles           | Email login for the multi-parent returns `[900001, 900002]` and null active student. Membership login selects the requested sibling.                                                                                              |
| One/self-managed profile    | Single-parent email login selects `900003`; self-managed email or membership login selects `900004`.                                                                                                                              |
| Account queries             | `me { students }` and `myStudents` returns only the caller's students, sorted by membership ID. An anonymous request returns `UNAUTHENTICATED`.                                                                                   |
| Profile switching           | As multi-parent, `selectActiveStudent` with `900002` changes the active membership and preserves the User ID. `900003` returns `FORBIDDEN`.                                                                                       |
| Linking                     | As multi-parent, `linkManagedStudent` with `900006` succeeds and activates it. Repeating it or linking `900003` returns `CONFLICT`; `999999` returns `NOT_FOUND`. Staff returns `FORBIDDEN`; anonymous returns `UNAUTHENTICATED`. |
| Existing refresh session    | Switch/link should not set a refresh cookie. `refreshAccessToken` rotates the existing cookie and applies email-login selection rules: multiple students means null active student.                                               |
| Logout/replay               | `logout` clears/revokes the refresh cookie; refreshing with the old cookie fails. Reusing an already-rotated refresh cookie also fails and revokes the account's active refresh sessions.                                         |
| Setup confirmation          | `requestAccountSetup` with a missing/claimed membership returns `true` without a setup email. Valid requests require SMTP to check actual delivery.                                                                               |
| New account completion      | First try the printed new-account token with missing/blank owner details: expect a field-specific error without claiming it. Then supply all three owner details and a nonblank password; the response activates `900005`.        |
| Existing account completion | Use the printed existing-parent token, omit owner details, and supply a new password. Existing names/phone remain, `900007` becomes active, and old refresh sessions are revoked.                                                 |
| Setup replay/expiry         | Reuse a successful token, or submit either printed expired/used token: expect `BAD_USER_INPUT` on `token`.                                                                                                                        |
| Admin permissions           | `createStaffAccount` and `adminSetPassword` succeed only as admin. Coach/volunteer/student callers get `FORBIDDEN`. Creating staff with role `STUDENT` returns `BAD_USER_INPUT`.                                                  |

For example, new-account completion variables are:

```json
{
  "token": "COPY_NEW_USER_TOKEN_FROM_SEED_OUTPUT",
  "newPassword": "DevOnly!12345",
  "firstName": "Dev",
  "lastName": "SetupParent",
  "phoneNumber": "0000000000"
}
```

Run password-changing checks last. `adminSetPassword` can target the nonstaff fixture User
`00000000-0000-4000-8000-000000000004`. Test `createStaffAccount` with a separate synthetic email, such as
`created.staff@e2s.test`; repeating that email returns `BAD_USER_INPUT`. Mutations alter fixture state,
so after linking/setup, initial student counts and active-profile expectations change. Rerunning the
seed normally preserves those changes. Add `--reset-auth` to restore the fixture passwords and
initial ownership and make the seeded setup/linking cases fresh again. Accounts created separately
through `createStaffAccount` or setup with your own email are not removed by this reset.

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
