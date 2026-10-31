export const userTypeDefs = `#graphql
  enum Role {
    COACH
    VOLUNTEER
    ADMIN
    STUDENT
  }

  type Student {
    membershipId: Int!
    firstName: String!
    lastName: String
    preferredName: String
    points: Int!
    birthDate: String!
  }

  type User {
    id: UUID!
    firstName: String!
    lastName: String!
    email: String!
    role: Role!
    students: [Student!]!
  }

  input LoginInput {
    email: String
    membershipId: Int
    password: String!
  }

  type AuthPayload {
    accessToken: String!
    user: User!
    managedStudents: [Student!]!
    activeStudent: Student
  }

  extend type Query {
    me: User
    myStudents: [Student!]!
  }

  extend type Mutation {
    loginStaff(
      email: String!
      password: String!
    ): AuthPayload!

    loginStudent(input: LoginInput!): AuthPayload!

    selectActiveStudent(membershipId: Int!): AuthPayload!

    requestAccountSetup(email: String!, membershipId: Int!): Boolean!

    completeAccountSetup(
      token: String!
      newPassword: String!
      firstName: String
      lastName: String
      phoneNumber: String
    ): AuthPayload!

    refreshAccessToken: AuthPayload!

    logout: Boolean!

    createStaffAccount(
      firstName: String!
      lastName: String!
      email: String!
      phoneNumber: String!
      password: String!
      role: Role!
    ): User!

    adminSetPassword(
      userId: UUID!
      newPassword: String!
    ): Boolean!
  }
`;
