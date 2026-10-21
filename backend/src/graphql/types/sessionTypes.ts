export const sessionTypeDefs = `#graphql
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

  extend type Query {
    "Sessions for a calendar month, optionally filtered by status. Omit month+year for the current month."
    sessions(
      month: Int
      year: Int
      sessionStatuses: [SessionStatus!]
    ): [Session!]!

    "A single session by id. Returns a NOT_FOUND error if no session matches."
    session(id: ID!): Session!
  }
`;
