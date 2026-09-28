export const typeDefs = `#graphql
  type HealthStatus {
    "Always true if the GraphQL server can resolve queries"
    ok: Boolean!
    "true if the server successfully queried Postgres"
    databaseConnected: Boolean!
    timestamp: String!
  }

  type Query {
    "Basic wiring check: server + database connectivity."
    health: HealthStatus!
  }
`;
