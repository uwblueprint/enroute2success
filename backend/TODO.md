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
(visible to the student and parents). Points are in the open stack #60–#66; issues already raised in
review there (redundant `session_id` index, `ID` vs `UUID` args, null vs `NOT_FOUND` consistency,
0–1 score limit) are not repeated here.

- [ ] **Draft vs. sent state for points.** Feedback has this now (see **Done**). `SessionPoints` still
      needs the same `sent_at`: students currently see points as soon as they're created, even for
      draft sessions, since `myPoints` / `mySessionPoints` don't filter those out like the feedback
      queries do. Once sent, edits should be visible as soon as they're saved, without changing
      `sent_at`.
- [ ] **Only count sent points in `Student.points`.** The stack increments `Student.points` on
      `createSessionPoints` / `updateSessionPoints`, so draft points would show up in a student's
      total. Move the increment to the send step (and adjust it on edits to sent points).
- [ ] **One save / one send for the whole student.** The page saves message, points and attachments
      together, but the API has separate create/update mutations for feedback and points, so the
      frontend has to know which rows exist and can half-save. Proposed:
      `saveSessionReport(sessionId, studentId, text, points, attachments)` (upsert, draft) and
      `sendSessionReport(sessionId, studentId)`, both in one transaction. Open question: can a coach
      send points with an empty message? (`validateText` currently rejects empty feedback.)
- [ ] **Session roster with attendance.** The page lists the session's students (sorted by last name,
      with previous/next navigation) with Present/Absent status and counts, plus a "Feedback not sent"
      count. There is no enrollment or attendance table yet (see the `TODO`s in `feedbackService` and
      `sessionPointsService`). Needs something like
      `sessionRoster(sessionId): [{ student, attendance, feedbackSentAt }]`. Depends on the Attendance
      flow design.
- [ ] **`editableUntil` on `Session`.** Header shows "Editable until Nov 5". Expose the end of the
      7-day window from `isWithinSessionEditWindow` (stack #63) so the frontend doesn't redo the
      timezone math.
- [ ] **"Live" session status.** Header shows a Live badge; `SessionStatus` only has
      draft/scheduled/cancelled. Either derive it on the frontend from start/end times or add a
      computed field.
- [ ] **Feedback attachments (files team).** Coaches attach uploaded files (e.g. a 112 MB `.mp4`) and
      web links to a student's feedback. `File` has no link to feedback/session, and there's no link
      attachment type. Needs a feedback ↔ attachment relation (file or URL) and to follow the
      draft/sent visibility rules.
- [ ] **Student avatar.** Design shows a profile picture per student; `Student` has no image field.
      Low priority (placeholder works).

## Done

- [x] **Draft vs. sent feedback.** `Feedback` has a nullable `sent_at` (exposed as `sentAt`) and a
      `sendFeedback(id)` mutation. Students and parents only see sent feedback; edits after sending
      are visible right away and keep the original `sent_at`.

- [x] **Field-specific login errors.** `loginStaff` and `loginStudent` now return
      `ACCOUNT_NOT_FOUND` (`field`: `email` or `membershipId`) or `INCORRECT_PASSWORD`
      (`field`: `password`) instead of one generic error.
