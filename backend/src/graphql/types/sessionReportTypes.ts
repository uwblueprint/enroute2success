export const sessionReportTypeDefs = `#graphql
  "A student's feedback and points for one session, which coaches save and send together."
  type SessionReport {
    sessionId: UUID!
    studentId: Int!
    feedback: Feedback
    points: SessionPoints
    "ISO 8601. Null until the report is sent."
    sentAt: String
  }

  input SaveSessionReportInput {
    sessionId: UUID!
    studentId: Int!
    "Can be empty. Empty messages are hidden from students and parents."
    text: String!
    points: SessionPointsCategoriesInput!
  }

  extend type Mutation {
    "Create or update a student's feedback and points for a session. Unsent reports stay drafts; edits to a sent report are visible right away. Staff only."
    saveSessionReport(input: SaveSessionReportInput!): SessionReport!

    "Send a saved report so the student and their parents can see it, and add its points to the student's total. Sending a report again returns it unchanged. Returns NOT_FOUND if nothing has been saved yet. Staff only."
    sendSessionReport(sessionId: UUID!, studentId: Int!): SessionReport!
  }
`;
