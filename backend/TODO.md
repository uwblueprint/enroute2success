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

## Done

- [x] **Field-specific login errors.** `loginStaff` and `loginStudent` now return
      `ACCOUNT_NOT_FOUND` (`field`: `email` or `membershipId`) or `INCORRECT_PASSWORD`
      (`field`: `password`) instead of one generic error.
