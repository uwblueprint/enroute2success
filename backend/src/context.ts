import type { PrismaClient } from '../generated/client';
import { prisma } from './prisma';

export interface GraphQLContext {
  prisma: PrismaClient;
}

export async function createContext(): Promise<GraphQLContext> {
  return { prisma };
}
