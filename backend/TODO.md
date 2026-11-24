# Backend to-do

Backend fixes and additions needed before frontend work starts (January 2027), found by comparing
the Figma designs against the GraphQL API. Organized by design flow. Move items to **Done** when
they merge.

## Sign in / create account / forgot password

- [ ] **Unify login into one mutation.** _Blocked: waiting on PM sign-off._
      The design has one "Membership ID or Email" form for students, parents and staff, but the API has
      `loginStaff` and `loginStudent`, which each reject the other kind of account. Replace both with
      `login(identifier: String!, password: String!): AuthPayload!`: an all-digit identifier is a
      membership ID, anything else is an email. The frontend routes on `AuthPayload.user.role`.
      Keep the `ACCOUNT_NOT_FOUND` / `INCORRECT_PASSWORD` errors.
      _Until then:_ the frontend can call `loginStudent` and, if it returns `ACCOUNT_NOT_FOUND` for an
      email, retry with `loginStaff`.
- [ ] **Split `completeAccountSetup`.** _Waiting on review of the onboarding flow designs._
      The design logs the user in right after "Create password" and collects student info in a later
      onboarding flow, but the mutation requires the parent's name, phone and student details up front.
      Proposed: `completeAccountSetup(token, newPassword)` creates and logs in the user; onboarding
      uses a new `updateMe(...)` plus the existing `createManagedStudent`. Also expose some way to tell
      that onboarding isn't finished (e.g. a `needsOnboarding` field, or empty `managedStudents`).
- [ ] **Check setup/reset links before showing the form.** Add a query like
      `verifyAccountSetupToken(token: String!): { email }` so the page can show an
      expired-link state instead of failing on submit (setup tokens last 1 hour). The design also needs
      an expired-link screen.
- [ ] **Give "email already in use" its own error code.** `requestAccountSetup` and
      `completeAccountSetup` return `BAD_USER_INPUT` + `field: 'email'`. Switch to a
      dedicated code (e.g. `EMAIL_IN_USE`) to drive the "already created an account" screen.
- [ ] **Forgot / reset / change password.** _Has its own ticket._ The design needs:
  - `requestPasswordReset(identifier: String!)`, which takes an email or membership ID, returns the
    address the email went to (the "We sent an email to …" screen) and returns `ACCOUNT_NOT_FOUND`
    when no account matches (the "Looks like you don't have an account" screen).
  - `resetPassword(token: String!, newPassword: String!): AuthPayload!`, which logs the user in
    afterwards.
  - `changePassword(currentPassword: String!, newPassword: String!)` for logged-in users.

## Feedback & points (coach portal)

Design: one page per session where a coach goes student by student, writes a message, adds
attachments, ticks point criteria, then either **Save changes** (draft) or **Send Points & Feedback**
(visible to the student and parents).

- [ ] **Session roster with attendance.** The page lists the session's students (sorted by last name,
      with previous/next navigation) with Present/Absent status and counts, plus a "Feedback not sent"
      count. There is no enrollment or attendance table yet (see the `TODO`s in `sessionReportService`). Needs something like
      `sessionRoster(sessionId): [{ student, attendance, feedbackSentAt }]`. Depends on the Attendance
      flow design.
- [ ] **`editableUntil` on `Session`.** Header shows "Editable until Nov 5". Expose the end of the
      7-day window from `isWithinSessionEditWindow` so the frontend doesn't redo the
      timezone math.
- [ ] **"Live" session status.** Header shows a Live badge; `SessionStatus` only has
      draft/scheduled/cancelled. Either derive it on the frontend from start/end times or add a
      computed field.
- [ ] **Feedback attachments (files team).** Coaches attach uploaded files (e.g. a 112 MB `.mp4`) and
      web links to a student's feedback. `File` has no link to feedback/session, and there's no link
      attachment type. Needs a feedback ↔ attachment relation (file or URL) and to follow the
      draft/sent visibility rules. Attachments should be saved through `saveSessionReport` so the
      whole report still saves in one transaction.
- [ ] **Student avatar.** Design shows a profile picture per student; `Student` has no image field.
      Low priority (placeholder works).

## Session history (student / parent side)

Design: a list of the student's past sessions with attendance status and an "Unread updates" badge,
and a detail page per session showing feedback, homework, attendance and points. Homework stays
separate from session reports (its own reads and writes).

- [ ] **Merge feedback and points reads.** _Deferred: revisit later._ The detail page always reads
      feedback and points together, and the reads check access differently: feedback reads take a
      `studentId` plus a "manages this student" check, while `myPoints` / `mySessionPoints` use the
      active student, so a parent can read any child's feedback but only the active child's points.
      Proposed: replace `studentSessionFeedback` and `mySessionPoints` with
      `sessionReport(sessionId, studentId): SessionReport`, and `sessionFeedback` and
      `sessionPointsForSession` with `sessionReports(sessionId)` for staff, using one access rule
      (`studentId` + manages check). Decide on `studentFeedback` / `myPoints` after seeing the
      "Feedback & Homework" and "Points & Rewards" list pages.
- [ ] **Session history list.** Needs the sessions a student registered for, which depends on the
      registration/attendance table (same blocker as the coach roster). Also needs the
      "Only show sessions attended" filter.
- [ ] **Attendance states.** Present, Absent, Cancelled and "Attendance not recorded". Here
      "Cancelled" means the student cancelled their registration, which is different from
      `session_status: cancelled`.
- [ ] **"Unread updates" badge.** Needs per-user read tracking (e.g. a `seen_at` per report), which
      doesn't exist.
- [ ] **Feedback author name.** The detail page shows "From [Coach name]", but `Feedback` only exposes
      `giverId` and students can't look up staff. Add a `giver { firstName lastName }` field.
- [ ] **Session type.** The list shows a golf/chess/workshop icon, but `session_type` isn't exposed
      on `Session` and the enum has no workshop value.
- [ ] **Homework.** Doesn't exist yet. Separate reads and writes from session reports.
- [ ] **Design copy bugs (tell the designer).** On the "Absent" screen the points card says "No
      points were awarded" but shows "Total 7 of 10 points", and the attendance text says "Staff
      marked Jordan as present."

## Done

- [x] **Save and send feedback and points together.** `saveSessionReport` creates or updates a
      student's feedback and points for a session in one transaction, and `sendSessionReport` sends
      both. They replace `createFeedback`, `updateFeedback`, `sendFeedback`, `createSessionPoints` and
      `updateSessionPoints`. Coaches can send with an empty message; students and parents don't see
      empty feedback.
- [x] **Draft vs. sent feedback and points.** `Feedback` and `SessionPoints` have a nullable `sent_at`
      (exposed as `sentAt`). Students and parents only see sent rows, and only sent points count toward
      `Student.points`. Edits after sending are visible right away and keep the original `sent_at`.

- [x] **Field-specific login errors.** `loginStaff` and `loginStudent` now return
      `ACCOUNT_NOT_FOUND` (`field`: `email` or `membershipId`) or `INCORRECT_PASSWORD`
      (`field`: `password`) instead of one generic error.
