export const feedbackTypeDefs = `#graphql
  type Feedback {
    id: ID!
    studentId: Int!
    giverId: ID!
    updatedById: ID!
    sessionId: ID!
    text: String!
    "ISO 8601"
    createdAt: String!
    "ISO 8601"
    updatedAt: String!
  }

  extend type Query {
    "All feedback for a session. Staff only."
    sessionFeedback(sessionId: ID!): [Feedback!]!

    "Feedback for one student in a session, or null if none exists. Staff only."
    studentSessionFeedback(studentId: Int!, sessionId: ID!): Feedback

    "All feedback for the active student. Students and parents only."
    myFeedback: [Feedback!]!

    "Feedback for the active student in a session, or null if none exists. Students and parents only."
    mySessionFeedback(sessionId: ID!): Feedback
  }
`;

export const feedbackCreateMutationTypeDefs = `#graphql
  input CreateFeedbackInput {
    studentId: Int!
    sessionId: ID!
    text: String!
  }

  extend type Mutation {
    "Create feedback for a student in a session. Staff only."
    createFeedback(input: CreateFeedbackInput!): Feedback!
  }
`;

export const feedbackUpdateMutationTypeDefs = `#graphql
  input UpdateFeedbackInput {
    text: String!
  }

  extend type Mutation {
    "Update existing feedback. Staff only."
    updateFeedback(id: ID!, input: UpdateFeedbackInput!): Feedback!
  }
`;
