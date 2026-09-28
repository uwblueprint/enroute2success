import "dotenv/config";
import http from "node:http";
import express from "express";
import cors from "cors";
import { ApolloServer } from "@apollo/server";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { expressMiddleware } from "@as-integrations/express5";
import { typeDefs } from "./schema/typeDefs";
import { resolvers } from "./schema/resolvers";
import { createContext, type GraphQLContext } from "./context";
import { prisma } from "./prisma";

const PORT = Number(process.env.PORT ?? 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173";

async function main() {
  const app = express();
  // Apollo Server drains this httpServer on shutdown for graceful exit.
  const httpServer = http.createServer(app);

  const apolloServer = new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
  });
  await apolloServer.start();

  app.use(
    "/graphql",
    cors({ origin: CORS_ORIGIN, credentials: true }),
    express.json(),
    expressMiddleware(apolloServer, {
      context: createContext,
    })
  );

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  await new Promise<void>((resolve) => httpServer.listen(PORT, resolve));
  console.log(`🚀 Backend ready at http://localhost:${PORT}`);
  console.log(`🚀 GraphQL endpoint: http://localhost:${PORT}/graphql`);

  const shutdown = async () => {
    console.log("Shutting down...");
    await prisma.$disconnect();
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
