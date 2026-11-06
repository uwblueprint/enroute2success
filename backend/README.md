# Backend development fixtures and manual checks

The dev seed (`src/scripts/seed.ts`) prepares accounts, students, sessions, and feedback for manual
GraphQL checks. It creates fixture data; it does not run API assertions or create refresh tokens.

Each run replaces **all feedback, sessions, and session series** in the local development database,
including entries created during previous manual checks. Matching accounts and students are preserved.

## Run the seed

The Docker backend and PostgreSQL services must already be running and the Prisma client must be
generated (the Compose backend startup generates it). Apply migrations and seed from the repository root:

```sh
docker compose exec backend npm run prisma:migrate:deploy
docker compose exec backend npm run db:seed
```

The seed requires `NODE_ENV=development` and a `DATABASE_URL` pointing to the `e2s_db` database on port
5432 via host `postgres`, `localhost`, or `127.0.0.1`, so it can also be run from `backend/` on the host
with `npm run db:seed`. It refuses other targets, including the `pern_db` configuration.

Compose defaults to `pern_db`, so select `POSTGRES_DB=e2s_db` in your local Compose configuration before
starting the development database. The backend also needs its existing `JWT_SECRET` configuration
(at least 32 bytes), normally in `backend/.env`, for login and the student-token command below.

## Session fixtures

Every run inserts one weekly series and seven calendar sessions relative to the current month in the org
timezone: draft and cancelled sessions, several on the same day, one near midnight on the last day of the
month, and one in the previous month. It also adds the five feedback sessions listed below, for 12 sessions
in total.

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

The student fixtures, feedback/session cleanup, and replacement sessions/feedback use a second transaction.
Feedback is deleted before sessions to respect the session foreign key's `Restrict` rule. If any step in
that transaction fails, its changes roll back. An occupied student fixture ID with a different manager or
name is rejected before cleanup; it is never overwritten.

If a password-reset test changes a fixture password, rerunning the seed will not restore the original
password. Use the current password or change it with the admin password-reset mutation.

After seeding, send operations to `http://localhost:4000/graphql` using the sample credentials.
Use fresh logins to test refresh rotation, replay, expiry, logout, and session revocation. Duplicate-email
checks can reuse a seeded email; confirmation-mismatch checks need no extra fixture account.

These fixtures are for local development only. Production admin bootstrapping uses a separate process.

## Feedback fixtures

Students **A (`990001`)** and **B (`990002`)** are both managed by `nonstaff@e2s.test`. Their names are
`Dev Feedback A` and `Dev Feedback B`. Existing matching student records are left unchanged.

The feedback sessions use fixed UUIDs and dates relative to the day you seed in `America/Toronto`,
including daylight saving. They start at local midnight and end at the next local midnight. Reseed if
the Toronto calendar date changes before your timing checks.

| Session       | UUID                                   | Date at seeding              |
| ------------- | -------------------------------------- | ---------------------------- |
| Today         | `10000000-0000-4000-8000-000000000001` | Today                        |
| Day 7         | `10000000-0000-4000-8000-000000000002` | Seven calendar days ago      |
| Day 8         | `10000000-0000-4000-8000-000000000003` | Eight calendar days ago      |
| Future        | `10000000-0000-4000-8000-000000000004` | Tomorrow                     |
| Today (empty) | `10000000-0000-4000-8000-000000000005` | Today; initially no feedback |

| Feedback UUID                          | Student | Session | Original author |
| -------------------------------------- | ------- | ------- | --------------- |
| `20000000-0000-4000-8000-000000000001` | A       | Today   | Coach           |
| `20000000-0000-4000-8000-000000000002` | B       | Today   | Admin           |
| `20000000-0000-4000-8000-000000000003` | A       | Day 7   | Coach           |
| `20000000-0000-4000-8000-000000000004` | A       | Day 8   | Admin           |
| `20000000-0000-4000-8000-000000000005` | A       | Future  | Admin           |

Every seeded entry initially has `updated_by = giver` and `updated_at = created_at`. The Today entry for
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

`loginStaff` intentionally rejects `nonstaff@e2s.test`. For local student/parent checks, run this command
from the repository root. It uses the existing token helper and the backend's JWT secret to print a
STUDENT token for A, B, and no active student. It changes no database rows.

```sh
docker compose exec backend node --import tsx --input-type=module -e '
await import("dotenv/config");
if (process.env.NODE_ENV !== "development") {
  throw new Error("Student fixture tokens require NODE_ENV=development");
}
const { generateAccessToken } = await import("./src/utils/accessTokens.ts");
const { Role } = await import("./generated/client.ts");
for (const activeStudentId of [990001, 990002, null]) {
  const token = generateAccessToken({
    userId: "00000000-0000-4000-8000-000000000004",
    role: Role.STUDENT,
    activeStudentId,
  });
  console.log(`${activeStudentId ?? "none"}: ${token}`);
}
'
```

If you run the backend on the host, run the same `node` command from `backend/` with
`NODE_ENV=development` instead of the `docker compose exec backend` prefix.

Access tokens expire after **15 minutes**. Log staff in again or rerun the student-token command to
refresh them; reseeding is only necessary when you want to reset fixture data or session dates.

## Feedback read checks

Run the baseline reads before mutations, since successful writes change the expected fixture results.

With any staff token:

```graphql
query StaffFeedback($sessionId: ID!, $studentId: Int!) {
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
  "studentId": 990001
}
```

Expect Today feedback for A then B, in ascending `createdAt` order. The single-student lookup returns
only A's entry. Check that IDs map correctly and timestamps are ISO strings. The empty session returns
`[]` and `null` respectively. With an absent session UUID, `sessionFeedback` returns `NOT_FOUND`;
the nullable `studentSessionFeedback` lookup returns `null` when queried on its own.

With a STUDENT token:

```graphql
query StudentFeedback($sessionId: ID!) {
  myFeedback {
    id
    studentId
    sessionId
    text
  }
  mySessionFeedback(sessionId: $sessionId) {
    id
    studentId
    text
  }
}
```

```json
{ "sessionId": "10000000-0000-4000-8000-000000000002" }
```

With A's token, expect only A's four entries, ordered Future, Today, Day 7, Day 8 by session date.
The detail lookup returns A's Day 7 entry. With B's token, expect only B's Today entry and `null` for
Day 7, even though A has feedback in that session. An absent session UUID makes `mySessionFeedback`
return `NOT_FOUND`.

## Feedback create checks

Use a coach token and the initially empty Today session:

```graphql
mutation CreateFeedback($input: CreateFeedbackInput!) {
  createFeedback(input: $input) {
    id
    studentId
    sessionId
    giverId
    updatedById
    text
    createdAt
    updatedAt
  }
}
```

```json
{
  "input": {
    "studentId": 990001,
    "sessionId": "10000000-0000-4000-8000-000000000005",
    "text": "  Local feedback check  "
  }
}
```

Expect one new entry with text `Local feedback check` and both staff IDs equal to the coach's ID.
Repeat the request to get `BAD_USER_INPUT`, with a message directing you to `updateFeedback`.
Substitute an absent student ID or session UUID to get `NOT_FOUND`. For an absent UUID you can use
`ffffffff-ffff-4fff-8fff-ffffffffffff`, which the seed does not create.

## Feedback update checks

Log in as the volunteer and edit the coach-authored Today entry:

```graphql
mutation UpdateFeedback($id: ID!, $input: UpdateFeedbackInput!) {
  updateFeedback(id: $id, input: $input) {
    id
    studentId
    sessionId
    giverId
    updatedById
    text
    createdAt
    updatedAt
  }
}
```

```json
{
  "id": "20000000-0000-4000-8000-000000000001",
  "input": { "text": "  Reviewed by volunteer  " }
}
```

Expect the same feedback ID, student, session, original coach `giverId`, and `createdAt`. The text
becomes `Reviewed by volunteer`, `updatedById` becomes the volunteer's ID, and `updatedAt` advances.
Rerun the staff read to confirm the session still has two entries. Updating an absent feedback UUID
returns `NOT_FOUND`.

## Feedback role, validation, and timing checklist

Check `errors[].extensions.code` for failures. These operations are manual checks; the seed does not
mark them as passed. Reseed between independent successful create scenarios so an existing pair does
not turn a timing check into a duplicate check. For timing creates, use B (`990002`), whose Day 7,
Day 8, and Future pairs are initially empty. For timing updates, use A's seeded entries above.

| Request                                                                  | Expected result                |
| ------------------------------------------------------------------------ | ------------------------------ |
| Any of the four feedback queries or two mutations, without Authorization | `UNAUTHENTICATED`              |
| STUDENT token calling either staff query or either mutation              | `FORBIDDEN`                    |
| Any staff role calling either `my...` query                              | `FORBIDDEN`                    |
| STUDENT token labeled `none` calling either `my...` query                | `FORBIDDEN`                    |
| Create/update with `text` set to `"   "` using a staff token             | `BAD_USER_INPUT`, field `text` |
| Coach creates/updates Today feedback                                     | Success                        |
| Volunteer creates/updates Today feedback                                 | Success                        |
| Admin creates/updates Today feedback                                     | Success                        |
| Coach creates/updates Day 7 feedback                                     | Success                        |
| Volunteer creates/updates Day 7 feedback                                 | Success                        |
| Coach creates/updates Day 8 feedback                                     | `FORBIDDEN`                    |
| Volunteer creates/updates Day 8 feedback                                 | `FORBIDDEN`                    |
| Coach/volunteer creates/updates Future feedback                          | `FORBIDDEN`                    |
| Admin creates/updates Day 8 or Future feedback                           | Success                        |

Enrollment and staff-to-session assignment are still the ticket's explicit TODOs. Any existing student
and session pair is currently accepted, subject to staff authorization, uniqueness, and timing rules.
