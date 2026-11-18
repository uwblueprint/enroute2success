export const fileTypeDefs = `#graphql
  enum FileStatus { 
    PENDING
    READY
  }

  type File {
    id: ID!
    originalName: String!
    mimeType: String!
    sizeBytes: Int!
    status: FileStatus!
    createdAt: String!
    downloadUrl: String    # signed, short-lived; only resolved when requested
  }

  type FileUploadTarget {
    fileId: ID!
    uploadUrl: String!     # presigned, short-lived
    expiresAt: String!
  }

  input RequestFileUploadInput {
    originalName: String!
    mimeType: String!
    sizeBytes: Int!
  }

  extend type Query {
    file(id: ID!): File
  }

  extend type Mutation {
    requestFileUpload(input: RequestFileUploadInput!): FileUploadTarget!
    confirmFileUpload(fileId: ID!): File!
    deleteFile(fileId: ID!): File!
  }
`;
