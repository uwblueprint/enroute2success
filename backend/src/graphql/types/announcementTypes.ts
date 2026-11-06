export const announcementTypeDefs = `#graphql
  type Announcement {
    id: ID!
    message: String!
    "ISO 8601 instant: 12:00 AM org time on the first day"
    start_date: String!
    "ISO 8601 instant: 11:59 PM org time on the last day"
    end_date: String!
    "ISO 8601. Null unless the announcement was soft-deleted"
    deleted_at: String
    created_by: ID!
    "ISO 8601"
    createdAt: String!
    "ISO 8601"
    updatedAt: String!
  }

  input CreateAnnouncementInput {
    message: String!
    "Calendar day as YYYY-MM-DD, today or later"
    start_date: String!
    "Calendar day as YYYY-MM-DD, today or later and not before start_date. Defaults to start_date"
    end_date: String
  }

  input UpdateAnnouncementInput {
    message: String
    "Calendar day as YYYY-MM-DD"
    start_date: String
    "Calendar day as YYYY-MM-DD"
    end_date: String
  }

  extend type Query {
    "Announcements that are live right now. Oldest start first."
    currentAnnouncements: [Announcement!]!

    "ADMIN only. Not deleted and not yet ended (live or upcoming). Oldest start first."
    liveAndUpcomingAnnouncements: [Announcement!]!

    "ADMIN only. Ended or deleted announcements. Newest start first."
    pastAnnouncements: [Announcement!]!
  }

  extend type Mutation {
    "ADMIN only."
    createAnnouncement(input: CreateAnnouncementInput!): Announcement!

    "ADMIN only. Live or upcoming announcements only."
    updateAnnouncement(id: ID!, input: UpdateAnnouncementInput!): Announcement!

    "ADMIN only. Soft delete; live or upcoming announcements only."
    deleteAnnouncement(id: ID!): Announcement!
  }
`;
