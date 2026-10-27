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
  }

  type AuthPayload {
    accessToken: String!
    user: User!
  }

  extend type Query {
    me: User
  }

  extend type Mutation {
    loginStaff(
      email: String!
      password: String!
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
