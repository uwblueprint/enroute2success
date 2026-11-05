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

    "Feedback for one student in a session, or null if none exists. Staff only."
    studentSessionFeedback(studentId: Int!, sessionId: UUID!): Feedback

    "All feedback for the active student. Students and parents only."
    myFeedback: [Feedback!]!

    "Feedback for the active student in a session, or null if none exists. Students and parents only."
    mySessionFeedback(sessionId: UUID!): Feedback
  }

  extend type Mutation {
    "Update existing feedback. Staff only."
    updateFeedback(id: ID!, input: UpdateFeedbackInput!): Feedback!
  }
`;
