export const feedbackTypeDefs = `#graphql
  "Written with saveSessionReport and sent with sendSessionReport."
  type Feedback {
    id: ID!
    studentId: Int!
    giverId: UUID!
    updatedById: UUID!
    sessionId: UUID!
    text: String!
    "ISO 8601. Null while the feedback is a draft that students and parents can't see."
    sentAt: String
    "ISO 8601"
    createdAt: String!
    "ISO 8601"
    updatedAt: String!
  }

  extend type Query {
    "All feedback for a session. Staff only."
    sessionFeedback(sessionId: UUID!): [Feedback!]!

    "Feedback for one student in a session, or null if none exists. Staff can view any student, including drafts; students and parents can only view sent, non-empty feedback for students they manage, and get NOT_FOUND for draft sessions."
    studentSessionFeedback(studentId: Int!, sessionId: UUID!): Feedback

    "All feedback for a student, newest session first. Staff can view any student, including drafts; students and parents can only view sent, non-empty feedback for students they manage."
    studentFeedback(studentId: Int!): [Feedback!]!
  }
`;
