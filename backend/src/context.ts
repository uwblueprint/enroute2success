import type { PrismaClient } from '../generated/client';
import { prisma } from './prisma';
import type { AuthenticatedStaff } from './auth';

export interface GraphQLContext {
  prisma: PrismaClient;
  auth: AuthenticatedStaff | null;
}

export async function createContext(): Promise<GraphQLContext> {
  return { prisma, auth: null };
}
