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

  type FileUploadField {
    name: String!
    value: String!
  }

  # Send an HTTP POST (multipart/form-data) to uploadUrl with every uploadFields entry as a form
  # field, in order, then the file itself as the last field, named "file". Then call confirmFileUpload.
  type FileUploadTarget {
    fileId: ID!
    uploadUrl: String!     # presigned, short-lived
    uploadFields: [FileUploadField!]!
    expiresAt: String!
  }

  input RequestFileUploadInput {
    originalName: String!
    mimeType: String!
    sizeBytes: Int!
  }

  extend type Query {
    file(id: UUID!): File
  }

  extend type Mutation {
    requestFileUpload(input: RequestFileUploadInput!): FileUploadTarget!
    confirmFileUpload(fileId: UUID!): File!
    deleteFile(fileId: UUID!): File!
  }
`;
