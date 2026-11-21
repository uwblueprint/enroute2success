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
    "Sessions starting from the first day through the last day (both inclusive, org time), optionally filtered by status. Oldest start first."
    sessions(
      "Calendar day as YYYY-MM-DD in org time, inclusive"
      from: String!
      "Calendar day as YYYY-MM-DD in org time, inclusive and not before from. At most 62 days after from."
      to: String!
      sessionStatuses: [SessionStatus!]
    ): [Session!]!

    "A single session by id. Returns a NOT_FOUND error if no session matches."
    session(id: UUID!): Session!
  }
`;
