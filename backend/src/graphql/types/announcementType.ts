export const announcementTypeDefs = `#graphql
    type AnnouncementDTO {
        id: ID!
        message: String!
        start_date: String!
        end_date: String
        deleted_at: String
        created_by: ID!
        createdAt: String!
        updatedAt: String!
    }

    input CreateAnnouncementInput {
        message: String!
        start_date: String!
        end_date: String
    }

    input UpdateAnnouncementInput {
        message: String
        start_date: String
        end_date: String
    }

    extend type Query {
        currentAnnouncements: [AnnouncementDTO!]!
        liveAndUpcomingAnnouncements: [AnnouncementDTO!]!
        pastAnnouncements: [AnnouncementDTO!]!
    }

    extend type Mutation {
        createAnnouncement(input: CreateAnnouncementInput!): AnnouncementDTO!
        updateAnnouncement(id: ID!, input: UpdateAnnouncementInput!): AnnouncementDTO!
        deleteAnnouncement(id: ID!): AnnouncementDTO!
    }
`;
