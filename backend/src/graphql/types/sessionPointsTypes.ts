export const sessionPointsTypeDefs = `#graphql
  type SessionPoints {
    id: ID!
    sessionId: ID!
    studentId: Int!
    givenById: ID!
    updatedById: ID!
    attendance: Int!
    punctuality: Int!
    teamwork: Int!
    focus: Int!
    discipline: Int!
    respect: Int!
    sportsmanship: Int!
    extraRecognition: Int!
    attendedWorkshop: Int!
    wonTournament: Int!
    total: Int!
    "ISO 8601"
    createdAt: String!
    "ISO 8601"
    updatedAt: String!
  }

  extend type Query {
    "All points rows for a session in creation order. Staff only."
    sessionPointsForSession(sessionId: ID!): [SessionPoints!]!

    "Points for one student in a session, or null if no row exists. Staff only."
    studentSessionPoints(studentId: Int!, sessionId: ID!): SessionPoints

    "All points rows for the active student, newest session first. Students and parents only."
    myPoints: [SessionPoints!]!

    "Points for the active student in a session, or null if no row exists. Students and parents only."
    mySessionPoints(sessionId: ID!): SessionPoints
  }
`;
