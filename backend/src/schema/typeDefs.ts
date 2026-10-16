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
    lastName: String!
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

  "Must match the session_status enum in schema.prisma exactly."
  enum SessionStatus {
    draft
    scheduled
    cancelled
  }

  type Session {
    id: ID!
    name: String!
    description: String
    location: String
    "ISO 8601"
    startDatetime: String!
    "ISO 8601"
    endDatetime: String!
    status: SessionStatus!
    maxAttendees: Int
  }

  type Query {
    health: HealthStatus!

    "Sessions for a calendar month, optionally filtered by status. Omit month+year for the current month."
    sessions(
      month: Int
      year: Int
      sessionStatuses: [SessionStatus!]
    ): [Session!]!

    "A single session by id. Returns a NOT_FOUND error if no session matches."
    session(id: ID!): Session!
    
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
