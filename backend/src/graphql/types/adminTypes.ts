export const adminTypeDefs = `#graphql
  extend type Query {
    "All users sorted by last name, optionally filtered by role (STUDENT means parent/student accounts). Deactivated users are left out unless includeDeactivated is true. Admin only."
    users(role: Role, includeDeactivated: Boolean = false): [User!]!
  }

  extend type Mutation {
    "Create an account of any role. STUDENT creates a parent/student account, whose students are added after logging in with createManagedStudent. Admin only."
    createUser(
      firstName: String!
      lastName: String!
      email: String!
      phoneNumber: String!
      password: String!
      role: Role!
    ): User!

    "Deactivate an account: the user can't log in, their sessions end right away, and their students stay linked. Feedback and points they wrote are kept. Deactivating an already-deactivated user returns it unchanged. Admins can't deactivate themselves or the last active admin. Admin only."
    deactivateUser(userId: UUID!): User!

    "Let a deactivated user log in again. Admin only."
    reactivateUser(userId: UUID!): User!
  }
`;
