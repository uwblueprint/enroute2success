export const sessionPointsTypeDefs = `#graphql
  "Written with saveSessionReport and sent with sendSessionReport. Each category is 0 or 1."
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
    "ISO 8601. Null while the points are a draft that students and parents can't see, and that doesn't count toward the student's total."
    sentAt: String
    "ISO 8601"
    createdAt: String!
    "ISO 8601"
    updatedAt: String!
  }

  input SessionPointsCategoriesInput {
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
  }

  extend type Query {
    "All points rows for a session in creation order. Staff only."
    sessionPointsForSession(sessionId: UUID!): [SessionPoints!]!

    "Points for one student in a session, or null if no row exists. Returns NOT_FOUND if the session or student does not exist. Staff only."
    studentSessionPoints(studentId: Int!, sessionId: UUID!): SessionPoints

    "Sent points for the active student, newest session first. Students and parents only."
    myPoints: [SessionPoints!]!

    "Sent points for the active student in a session, or null if there are none. Returns NOT_FOUND for draft sessions. Students and parents only."
    mySessionPoints(sessionId: UUID!): SessionPoints
  }
`;
