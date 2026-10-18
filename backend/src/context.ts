import type { ExpressContextFunctionArgument } from '@as-integrations/express5';
import type { Request, Response } from 'express';
import type { PrismaClient } from '../generated/client';
import { prisma } from './prisma';
import type { AuthenticatedStaff } from './auth';
import { verifyStaffAccessToken } from './accessTokens';

export interface GraphQLContext {
  prisma: PrismaClient;
  req: Request;
  res: Response;
  auth: AuthenticatedStaff | null;
}

export async function createContext({
  req,
  res,
}: ExpressContextFunctionArgument): Promise<GraphQLContext> {
  const token = req.headers.authorization?.match(/^Bearer +(\S+)$/i)?.[1];
  const auth = token ? verifyStaffAccessToken(token) : null;

  return { prisma, req, res, auth };
}
