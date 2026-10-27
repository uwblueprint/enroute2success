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
backend appends the `token` query parameter. If unset, the URL defaults to `/complete-account-setup`
under `CORS_ORIGIN`, or `http://localhost:5173` when no origin is configured. Email uses the existing
`SMTP_USER`, `SMTP_PASS`, and optional `EMAIL_FROM` configuration. Without SMTP credentials, the
existing email service skips delivery. Delivery failures return the same confirmation response.

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
