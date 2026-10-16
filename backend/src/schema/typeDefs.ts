export const typeDefs = `#graphql
  scalar UUID

  enum StaffType {
    COACH
    VOLUNTEER
    ADMIN
  }

  type User {
    id: UUID!
    firstName: String!
    lastName: String
    email: String!
    role: StaffType
  }

  type AuthPayload {
    accessToken: String!
    user: User!
  }

  type HealthStatus {
    ok: Boolean!
    databaseConnected: Boolean!
    timestamp: String!
  }

  type Query {
    health: HealthStatus!
    me: User
  }

  type Mutation {
    loginStaff(
      email: String!
      password: String!
    ): AuthPayload!

    refreshAccessToken: AuthPayload!

    logout: Boolean!

    createStaffAccount(
      firstName: String!
      lastName: String!
      email: String!
      phoneNumber: String!
      password: String!
      passwordConfirm: String!
      role: StaffType!
    ): User!

    adminSetPassword(
      userId: UUID!
      newPassword: String!
    ): Boolean!
  }
`;
