# Backend development fixtures and manual checks

The dev seed (`src/scripts/seed.ts`) creates synthetic staff accounts, parent and student accounts,
Student profiles, and development setup tokens for manual authentication checks. A full seed also
adds fixtures for sessions, announcements, feedback, and session points.

## Run the seed

Start the local Docker backend and PostgreSQL services. The Compose backend generates the Prisma
client on startup. Apply migrations and seed the auth fixtures from the repository root.

```sh
docker compose exec backend npm run prisma:migrate:deploy
docker compose exec backend npm run db:seed -- --auth-only
```

`--auth-only` preserves session points, existing student totals, feedback, sessions, session series,
and announcements.

For calendar, announcement, feedback, or points checks, run a full seed. It replaces **all session
points, feedback, sessions, session series, and announcements** in the local development database,
including rows added during earlier manual checks. It subtracts the removed points rows' contributions
from student totals and sets membership `900001` to **11 points** from the new fixtures.

```sh
docker compose exec backend npm run db:seed
```

Review the existing staff-role migration before applying the migration history to a populated database.

To restore fixture passwords and repeat signup, run:

```sh
docker compose exec backend npm run db:seed -- --auth-only --reset-auth
```

`--reset-auth` restores all seven seeded account passwords to `DevOnly!12345`, reactivates them,
clears their refresh sessions, restores the four seeded student assignments, and replaces setup tokens for the three
setup fixture emails. It removes the completed `setup.new@e2s.test` signup and its student profiles,
including any points attached to those profiles. Pair `--reset-auth` with `--auth-only` to keep the
calendar fixtures, feedback, and points for the four seeded students. The reset rolls back if the
signup account has a staff role or announcements, or if a database constraint blocks deletion.

The seed requires `NODE_ENV=development` and a `DATABASE_URL` pointing to the `e2s_db` database on port
5432 via host `postgres`, `localhost`, or `127.0.0.1`, so it can also be run from `backend/` on the host
with `npm run db:seed`. It refuses other targets, including the `pern_db` configuration.

Compose defaults to `pern_db`. Set `POSTGRES_DB=e2s_db` in your local Compose configuration before
initializing the development database. Login requires the backend's `JWT_SECRET` configuration.

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

A full seed inserts one weekly series and seven calendar sessions relative to the current month in
the org timezone. They include draft and cancelled sessions, several on the same day, one near
midnight on the last day of the month, and one in the previous month. The
[feedback fixtures](#feedback-fixtures) add five sessions, for 12 sessions in total.

## Announcement fixtures

A full seed inserts five announcements created by `admin@e2s.test` relative to today in the org
timezone. Two are live now (one single-day and one multi-day), one is upcoming, one is expired, and
one was soft-deleted while live. `currentAnnouncements` returns the two live ones,
`liveAndUpcomingAnnouncements` adds the upcoming one, and `pastAnnouncements` returns the expired and
soft-deleted ones.

## Sample credentials

All seven seeded login accounts initially use the development-only password `DevOnly!12345`.
The seed hashes each account's password separately with the application's Argon2id helper.

| Email                    | GraphQL role | Primary checks                                                            |
| ------------------------ | ------------ | ------------------------------------------------------------------------- |
| `admin@e2s.test`         | `ADMIN`      | Successful login; permitted account creation and password reset           |
| `coach@e2s.test`         | `COACH`      | Successful login; forbidden admin operations                              |
| `volunteer@e2s.test`     | `VOLUNTEER`  | Successful login; forbidden admin operations                              |
| `nonstaff@e2s.test`      | `STUDENT`    | Student login with zero profiles; staff login returns `ACCOUNT_NOT_FOUND` |
| `parent.multi@e2s.test`  | `STUDENT`    | Manages two students; email login returns a profile picker                |
| `parent.single@e2s.test` | `STUDENT`    | Manages one student; email login selects that student                     |
| `student@e2s.test`       | `STUDENT`    | Self-managed student; email and membership login select their profile     |

The profiles use first name `Dev`, the corresponding role label as the last name, and placeholder phone
number `0000000000`. These are synthetic accounts. Their UUIDs are fixed in the seed script.

The three family User IDs end in `0005` (multi-parent), `0006` (single-parent), and `0007`
(self-managed). The `nonstaff` User ID ends in `0004` and provides the empty-profile login fixture.

## Student fixtures

These are the initial assignments. Ordinary reruns preserve existing ownership. `--reset-auth`
restores the assignments below.

| Membership ID | Initial manager          | Purpose                                                    |
| ------------- | ------------------------ | ---------------------------------------------------------- |
| `900001`      | `parent.multi@e2s.test`  | First family profile, with 11 points after a full seed     |
| `900002`      | `parent.multi@e2s.test`  | Second family profile; preferred name `Dev Two`            |
| `900003`      | `parent.single@e2s.test` | Single-profile login; foreign profile for the multi-parent |
| `900004`      | `student@e2s.test`       | Self-managed student login                                 |

Each Student has a synthetic identity marker. If a reserved membership ID belongs to another
student, the script rolls back all auth fixtures rather than replacing or claiming that profile.

## Development setup tokens

The seed prints tokens and URLs for **new signup**, **expired setup**, and **already-used setup**.
Copy a token into `completeAccountSetup` to test completion locally. The seed stores token hashes,
and valid tokens expire in one hour. An ordinary rerun skips signup once the account exists.
`--reset-auth` restores the setup cases so you can repeat signup.

Complete setup for `setup.new@e2s.test` with the account owner's details and a student profile. A
successful signup creates both records and selects the student. Expired and already-used tokens
return `BAD_USER_INPUT` on `token`. To test delivery, call `requestAccountSetup` with an unused email
you control and SMTP configured.

## Rerunning and testing

The seed creates missing account/Student fixtures and setup tokens in one transaction. Existing
matching accounts are left unchanged, including passwords, contact details, and refresh sessions.
Existing Student profiles and their ownership are preserved. A conflicting account ID, email, role,
or Student identity rolls back all auth changes before touching sessions. Ordinary seeds skip setup
cases for emails that already have an account.

After checking the auth fixture IDs, a full seed replaces session points, feedback, sessions,
session series, and announcements in a separate transaction. It adjusts student totals and deletes
session points and feedback before deleting sessions. A failure rolls back all changes in that
transaction.

If a password-changing test changes a fixture password, an ordinary rerun preserves it. Use
`--auth-only --reset-auth` to restore the seeded passwords, or use the admin password-reset mutation
to change one account's password.

After seeding, send operations to `http://localhost:4000/graphql` using the sample credentials.
Use fresh logins to test refresh rotation, replay, expiry, logout, and session revocation. Reuse a
seeded email for duplicate-email checks.

These fixtures are for local development only. Production admin bootstrapping uses a separate process.

## Manual authentication checklist

Run the initial login and profile checks before creating new profiles. Use
`http://localhost:4000/graphql` and the fixture password above.

For `loginStudent`, provide variables such as:

```json
{ "input": { "email": "parent.multi@e2s.test", "password": "DevOnly!12345" } }
```

or:

```json
{ "input": { "membershipId": 900001, "password": "DevOnly!12345" } }
```

After login, set `Authorization: Bearer <accessToken>` for protected operations. Replace that token
after switching or creating a student. Retain the response's `refresh_token` cookie for refresh and
logout. If your client handles cookies manually, copy the cookie value from `Set-Cookie` into a
`Cookie` request header.

| Check                    | Operation and expected result                                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff access             | `loginStaff` for admin/coach/volunteer returns the matching role, no managed students, and no active student.                                                                             |
| Portal restrictions      | Staff credentials through `loginStudent`, or nonstaff credentials through `loginStaff`, return `ACCOUNT_NOT_FOUND`.                                                                       |
| Password/input failures  | Wrong passwords return `INCORRECT_PASSWORD`. Both or neither login identifier returns `BAD_USER_INPUT`.                                                                                   |
| Zero profiles            | On a freshly seeded database, email login for `nonstaff@e2s.test` returns no students and a null active student.                                                                          |
| Multiple profiles        | Email login for the multi-parent returns `[900001, 900002]` and null active student. Membership login selects the requested sibling.                                                      |
| One/self-managed profile | Single-parent email login selects `900003`; self-managed email or membership login selects `900004`.                                                                                      |
| Account queries          | `me { students { membershipId } }` and `myStudents { membershipId }` return the caller's students in membership order. Both require authentication.                                       |
| Profile switching        | As multi-parent, `selectActiveStudent` with `900002` changes the active membership and preserves the User ID. `900003` returns `FORBIDDEN`.                                               |
| Add a profile            | As multi-parent, `createManagedStudent` creates a profile with a generated membership ID and selects it. Staff get `FORBIDDEN`.                                                           |
| Existing refresh session | Switch or create a profile while sending the refresh cookie. `refreshAccessToken` rotates the cookie and retains the selected student.                                                    |
| Logout/replay            | `logout` clears/revokes the refresh cookie; refreshing with the old cookie fails. Reusing an already-rotated refresh cookie also fails and revokes the account's active refresh sessions. |
| Setup request            | `requestAccountSetup` with an unused email returns `true`. A seeded email gives `BAD_USER_INPUT` on `email`.                                                                              |
| New account completion   | Use the printed new-signup token with valid owner details, password, and student profile. Expect a new account and a selected student with a generated ID.                                |
| Setup replay/expiry      | Reuse a successful token, or submit either printed expired/used token: expect `BAD_USER_INPUT` on `token`.                                                                                |
| Admin permissions        | `createUser`, `users`, `deactivateUser`, `reactivateUser` and `adminSetPassword` succeed only as admin. Coach/volunteer/student callers get `FORBIDDEN`.                                  |

For example, new-account completion variables are:

```json
{
  "token": "COPY_NEW_USER_TOKEN_FROM_SEED_OUTPUT",
  "newPassword": "DevOnly!12345",
  "student": { "firstName": "Dev", "lastName": "Student", "birthDate": "2015-06-07" }
}
```

Run password-changing checks last. `adminSetPassword` can target the nonstaff fixture User
`00000000-0000-4000-8000-000000000004`. Test `createUser` with a separate synthetic email, such as
`created.staff@e2s.test`. Repeating that email returns `BAD_USER_INPUT`. Creating profiles changes
the expected student counts. Use the `setup.new@e2s.test` account to test creating extra profiles if
you want `--reset-auth` to remove them on the next run.

## Admin user checks

Log in as admin. Deactivation changes who can log in, so use accounts you create here rather than the
seeded fixtures.

```graphql
query Users($role: Role, $includeDeactivated: Boolean) {
  users(role: $role, includeDeactivated: $includeDeactivated) {
    id
    firstName
    lastName
    role
    deactivatedAt
    students {
      membershipId
    }
  }
}

mutation CreateUser(
  $firstName: String!
  $lastName: String!
  $email: String!
  $phoneNumber: String!
  $password: String!
  $role: Role!
) {
  createUser(
    firstName: $firstName
    lastName: $lastName
    email: $email
    phoneNumber: $phoneNumber
    password: $password
    role: $role
  ) {
    id
    role
  }
}

mutation Deactivate($userId: UUID!) {
  deactivateUser(userId: $userId) {
    id
    deactivatedAt
  }
}

mutation Reactivate($userId: UUID!) {
  reactivateUser(userId: $userId) {
    id
    deactivatedAt
  }
}
```

1. `users` lists everyone sorted by last name. `role: STUDENT` returns only parent/student accounts,
   and `role: COACH` only coaches.
2. Create a volunteer (`created.volunteer@e2s.test`) and a parent/student account
   (`created.parent@e2s.test`, role `STUDENT`) with password `DevOnly!12345`. The volunteer can log
   in with `loginStaff`, and the parent with `loginStudent` and no students.
3. Log in as the new volunteer, keep its access token, then deactivate it as admin. The volunteer's
   saved access token now gets `UNAUTHENTICATED`, `loginStaff` returns `ACCOUNT_DEACTIVATED` (or
   `INCORRECT_PASSWORD` with a wrong password), and refreshing with its cookie fails. It's missing
   from `users` unless `includeDeactivated` is `true`. Deactivating it again returns the original
   `deactivatedAt`.
4. Reactivate it. `deactivatedAt` is `null` and the volunteer can log in again.
5. Deactivating your own account returns `CANNOT_DEACTIVATE_SELF`. Deactivating the only active
   admin returns `LAST_ADMIN`. To check this, create a second admin, log in as it, and try to
   deactivate the seeded admin after deactivating any others. An unknown user ID returns `NOT_FOUND`.

## Student/parent account setup

Apply migrations and generate the Prisma client before using setup. The request step stores a
pending setup for an unused email.

```graphql
mutation {
  requestAccountSetup(email: "parent@example.com")
}
```

The setup email contains a random token. Its hash and email are stored in `account_setup_tokens`.
Tokens expire after one hour and can be redeemed once. Invalid or already registered emails return
`BAD_USER_INPUT`.

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

Email uses `SMTP_USER`, `SMTP_PASS`, and optional `EMAIL_FROM`. Without SMTP credentials, the email
service skips delivery. To exercise completion locally, use the seed's printed tokens.

Submit the token, account profile, password, and student profile together.

```graphql
mutation FinishSetup($token: String!, $newPassword: String!, $student: StudentInput!) {
  completeAccountSetup(
    token: $token
    newPassword: $newPassword
    firstName: "Dev"
    lastName: "SetupParent"
    phoneNumber: "0000000000"
    student: $student
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

Use the printed setup token in the variables above. Success sets the refresh cookie and returns a
token for the newly created student. Try the printed expired and used tokens with the same valid
inputs to verify rejection.

## Create another managed student

Use a student or parent token to create an additional profile.

```graphql
mutation {
  createManagedStudent(
    student: { firstName: "Dev", lastName: "Sibling", birthDate: "2017-06-07" }
  ) {
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

The response lists all managed profiles and selects the new student. Use the returned token for
`myPoints` or other active-student queries. Send the refresh cookie if you also want to verify that
refresh restores the newly selected profile.

## Feedback fixtures

Run a full seed to prepare the feedback fixtures. Students **A (`900001`)** and **B (`900002`)** are
the multi-parent account's students (`parent.multi@e2s.test`), created by the auth fixtures.

The feedback sessions use fixed UUIDs and dates relative to the day you seed in `ORG_TIMEZONE`,
including daylight saving. They start at local midnight and end at the next local midnight. Reseed if
the local calendar date changes before your timing checks.

| Session       | UUID                                   | Date at seeding              |
| ------------- | -------------------------------------- | ---------------------------- |
| Today         | `10000000-0000-4000-8000-000000000001` | Today                        |
| Day 7         | `10000000-0000-4000-8000-000000000002` | Seven calendar days ago      |
| Day 8         | `10000000-0000-4000-8000-000000000003` | Eight calendar days ago      |
| Future        | `10000000-0000-4000-8000-000000000004` | Tomorrow                     |
| Today (empty) | `10000000-0000-4000-8000-000000000005` | Today; initially no feedback |

| Feedback UUID                          | Student | Session | Original author | Sent       |
| -------------------------------------- | ------- | ------- | --------------- | ---------- |
| `20000000-0000-4000-8000-000000000001` | A       | Today   | Coach           | Yes        |
| `20000000-0000-4000-8000-000000000002` | B       | Today   | Admin           | No (draft) |
| `20000000-0000-4000-8000-000000000003` | A       | Day 7   | Coach           | Yes        |
| `20000000-0000-4000-8000-000000000004` | A       | Day 8   | Admin           | Yes        |
| `20000000-0000-4000-8000-000000000005` | A       | Future  | Admin           | Yes        |

Every seeded entry initially has `updated_by = giver` and `updated_at = created_at`. Sent entries have
`sent_at = created_at`. B's Today entry is an unsent draft: staff can see it, but the parent and student
can't until the report is sent with `sendSessionReport`. The Today entry for
A has an earlier creation timestamp than B's entry, regardless of insertion ordering. Old and future
entries are inserted directly by the seed to make both permitted and forbidden update cases available.

## Authenticate feedback requests

Send the following operation to `http://localhost:4000/graphql` in a GraphQL client:

```graphql
mutation Login($email: String!, $password: String!) {
  loginStaff(email: $email, password: $password) {
    accessToken
    user {
      id
      role
    }
  }
}
```

Variables for a coach login (substitute the admin or volunteer email to switch roles):

```json
{
  "email": "coach@e2s.test",
  "password": "DevOnly!12345"
}
```

Use the returned access token in the request headers:

```json
{ "Authorization": "Bearer YOUR_ACCESS_TOKEN" }
```

Staff fixture IDs end in `0001` for admin, `0002` for coach, and `0003` for volunteer, with the full
form `00000000-0000-4000-8000-000000000001` for admin. Use these to verify author/editor fields.

### Student tokens

Use `loginStudent` to sign in as the multi-parent fixture with a selected profile.

```graphql
mutation LoginForFeedback($input: LoginInput!) {
  loginStudent(input: $input) {
    accessToken
    activeStudent {
      membershipId
    }
  }
}
```

```json
{ "input": { "membershipId": 900001, "password": "DevOnly!12345" } }
```

Use membership ID `900002` for B. To obtain a token with no active student, replace `membershipId`
with the `email` field set to `parent.multi@e2s.test`. Use the returned token in the Authorization header.

Access tokens expire after **15 minutes**. Log in again to refresh them. Reseed when you need to
restore the feedback fixtures or update the session dates.

## Feedback read checks

Run the baseline reads before mutations, since successful writes change the expected fixture results.

With any staff token:

```graphql
query StaffFeedback($sessionId: UUID!, $studentId: Int!) {
  sessionFeedback(sessionId: $sessionId) {
    id
    studentId
    sessionId
    giverId
    updatedById
    text
    createdAt
    updatedAt
  }
  studentSessionFeedback(studentId: $studentId, sessionId: $sessionId) {
    id
    studentId
    text
  }
}
```

```json
{
  "sessionId": "10000000-0000-4000-8000-000000000001",
  "studentId": 900001
}
```

Expect Today feedback for A then B, in ascending `createdAt` order. The single-student lookup returns
only A's entry. Check that IDs map correctly and timestamps are ISO strings. The empty session returns
`[]` and `null` respectively. With an absent session UUID, `sessionFeedback` returns `NOT_FOUND`;
the nullable `studentSessionFeedback` lookup returns `null` when queried on its own.

With a STUDENT token:

```graphql
query StudentFeedback($studentId: Int!, $sessionId: UUID!) {
  studentFeedback(studentId: $studentId) {
    id
    studentId
    sessionId
    text
  }
  studentSessionFeedback(studentId: $studentId, sessionId: $sessionId) {
    id
    studentId
    text
  }
}
```

```json
{ "studentId": 900001, "sessionId": "10000000-0000-4000-8000-000000000002" }
```

Staff can query any student; a student or parent can only query students they manage. With the
multi-parent token and `studentId` `900001`, expect only A's four entries, ordered Future, Today,
Day 7, Day 8 by session date. The detail lookup returns A's Day 7 entry. With `studentId` `900002`,
the list is empty and Today and Day 7 details are `null`. B's Today entry is still a draft. A
`studentId` the caller doesn't manage, such as `900003`, returns `FORBIDDEN`. An absent session UUID
makes `studentSessionFeedback` return `NOT_FOUND` for a student or parent, and `null` for staff.

## Session points fixtures

A full seed adds two points rows for membership `900001`, managed by `parent.multi@e2s.test`. Each
category is `0` or `1`. The rows reuse Today and Day 7 from the [feedback fixtures](#feedback-fixtures).

| Student | Session | Points row UUID                        | Row total | Giver and updater | Sent       |
| ------- | ------- | -------------------------------------- | --------- | ----------------- | ---------- |
| A       | Today   | `30000000-0000-4000-8000-000000000001` | 7         | Coach             | Yes        |
| A       | Day 7   | `30000000-0000-4000-8000-000000000002` | 4         | Admin             | Yes        |
| B       | Today   | `30000000-0000-4000-8000-000000000003` | 3         | Admin             | No (draft) |

Only sent rows count toward a profile's total, so the full seed gives `900001` a total of 11 and
`900002` stays at 0. B's draft row pairs with B's draft Today feedback to make an unsent report.
Other students keep any points that came from outside the removed rows. A fresh auth-only seed gives
`900001` the default of 0.

## Manual session points checks

Apply migrations and run a full seed on a disposable local PostgreSQL database using the
[seed instructions](#run-the-seed). Reuse the [staff and student logins](#authenticate-feedback-requests)
and run the reads before creating or editing rows.

### Read points

Use `StaffPoints` with a staff token and `StudentPoints` with an active-student token.

```graphql
query StaffPoints($sessionId: UUID!, $studentId: Int!) {
  sessionPointsForSession(sessionId: $sessionId) {
    id
    studentId
    total
  }
  studentSessionPoints(sessionId: $sessionId, studentId: $studentId) {
    id
    total
  }
}

query StudentPoints($sessionId: UUID!) {
  myPoints {
    sessionId
    total
  }
  mySessionPoints(sessionId: $sessionId) {
    id
    total
  }
}
```

- With Today and `900001`, the staff list shows A's 7-point row and B's 3-point draft, and the
  detail shows A's row. An existing session with no
  rows gives `[]` for the list, and an existing student/session pair with no row gives `null` for the
  detail. Query the detail by itself with an unused session UUID or membership ID to get `NOT_FOUND`.
- For active student `900001`, `myPoints` returns Today (7) before Day 7 (4). After selecting
  `900002`, the list is empty and both session details are `null`. A multi-parent token with no
  active student gets `FORBIDDEN`. An unused session UUID gives `NOT_FOUND` for `mySessionPoints`;
  a malformed UUID variable gives `BAD_USER_INPUT`.
- Staff tokens get `FORBIDDEN` on student-only reads, and student tokens get `FORBIDDEN` on staff
  reads and mutations. Requests without a token get `UNAUTHENTICATED`.

## Save and send checks

Coaches save and send a student's feedback and points together. Run the read checks above first,
since these mutations change the fixtures.

```graphql
mutation SaveReport($input: SaveSessionReportInput!) {
  saveSessionReport(input: $input) {
    sentAt
    feedback {
      id
      text
      sentAt
      updatedById
    }
    points {
      id
      total
      sentAt
      givenById
      updatedById
    }
  }
}

mutation SendReport($sessionId: UUID!, $studentId: Int!) {
  sendSessionReport(sessionId: $sessionId, studentId: $studentId) {
    sentAt
    feedback {
      id
      sentAt
    }
    points {
      id
      total
      sentAt
    }
  }
}
```

As coach, run `SaveReport` for A in the empty Today session:

```json
{
  "input": {
    "sessionId": "10000000-0000-4000-8000-000000000005",
    "studentId": 900001,
    "text": "  Local report check  ",
    "points": {
      "attendance": 1,
      "punctuality": 1,
      "teamwork": 0,
      "focus": 0,
      "discipline": 0,
      "respect": 0,
      "sportsmanship": 0,
      "extraRecognition": 0,
      "attendedWorkshop": 0,
      "wonTournament": 0
    }
  }
}
```

1. Expect feedback with text `Local report check` and a 2-point row, both with `sentAt: null` and
   the coach as giver and updater. `allStudents { membershipId points }` still shows 11 for A, and
   A's parent doesn't see the session in `studentFeedback` or `myPoints`.
2. As volunteer, save again with `text` set to `""` and teamwork set to `1`. Expect the same
   feedback and points IDs, empty text, a total of 3, and the volunteer as updater.
3. Run `SendReport` for the same session and student. The report, feedback, and points get the same
   `sentAt`, and A's total rises to 14. The parent now sees the points in `myPoints`, but not the
   feedback, since its message is empty.
4. Save again with text `Edited after sending` and teamwork `0`. `sentAt` doesn't change, A's total
   drops to 13 right away, and the parent sees the new text without another send. Sending again
   returns the original `sentAt` and leaves the total at 13.
5. Send B's seeded draft (Today, `900002`). Its feedback and 3-point row both get `sentAt`, and B's
   total goes from 0 to 3.

Check `errors[].extensions.code` for failures:

| Request                                                    | Expected result                 |
| ---------------------------------------------------------- | ------------------------------- |
| Either mutation without Authorization                      | `UNAUTHENTICATED`               |
| Either mutation with a STUDENT token                       | `FORBIDDEN`                     |
| `sendSessionReport` with nothing saved, such as B in Day 7 | `NOT_FOUND`                     |
| Absent session UUID or membership ID                       | `NOT_FOUND`                     |
| A point category set to `2`                                | `BAD_USER_INPUT`, that category |
| `text` longer than 5,000 characters                        | `BAD_USER_INPUT`, field `text`  |
| Coach or volunteer saves or sends for Today or Day 7       | Success                         |
| Coach or volunteer saves or sends for Day 8 or Future      | `FORBIDDEN`                     |
| Coach or volunteer sends A's already-sent Day 8 report     | Returned unchanged              |
| Admin saves or sends for Day 8 or Future                   | Success                         |

Enrollment and staff-to-session assignment are still TODOs, so any existing student and session pair
is accepted, subject to staff authorization and timing rules.

Run `--auth-only` and `--auth-only --reset-auth` and confirm the points and totals for the seeded
profiles persist. Run the full seed twice and confirm both runs restore the three baseline rows, the
11-point total for `900001`, and 0 for `900002`.
