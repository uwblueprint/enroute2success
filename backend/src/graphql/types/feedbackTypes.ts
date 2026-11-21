export const feedbackTypeDefs = `#graphql
  type Feedback {
    id: ID!
    studentId: Int!
    giverId: UUID!
    updatedById: UUID!
    sessionId: UUID!
    text: String!
    "ISO 8601"
    createdAt: String!
    "ISO 8601"
    updatedAt: String!
  }

  input CreateFeedbackInput {
    studentId: Int!
    sessionId: UUID!
    text: String!
  }

  input UpdateFeedbackInput {
    text: String!
  }

  extend type Query {
    "All feedback for a session. Staff only."
    sessionFeedback(sessionId: UUID!): [Feedback!]!

    "Feedback for one student in a session, or null if none exists. Staff can view any student; students and parents can only view students they manage, and get NOT_FOUND for draft sessions."
    studentSessionFeedback(studentId: Int!, sessionId: UUID!): Feedback

    "All feedback for a student, newest session first. Staff can view any student; students and parents can only view students they manage."
    studentFeedback(studentId: Int!): [Feedback!]!
  }

  extend type Mutation {
    "Create existing feedback. Staff only."
    createFeedback(input: CreateFeedbackInput!): Feedback!
    "Update existing feedback. Staff only."
    updateFeedback(id: UUID!, input: UpdateFeedbackInput!): Feedback!
  }
`;
