import type { ExpressContextFunctionArgument } from '@as-integrations/express5';
import type { Request, Response } from 'express';
import type { PrismaClient } from '../../generated/client';
import { prisma } from '../prisma';
import type { AuthenticatedUser } from '../utils/auth';
import { verifyAccessToken } from '../utils/accessTokens';

export interface GraphQLContext {
  prisma: PrismaClient;
  req: Request;
  res: Response;
  auth: AuthenticatedUser | null;
}

export async function createContext({
  req,
  res,
}: ExpressContextFunctionArgument): Promise<GraphQLContext> {
  const token = req.headers.authorization?.match(/^Bearer +(\S+)$/i)?.[1];
  let auth = token ? verifyAccessToken(token) : null;

  // Access tokens last 15 minutes, so check the database to make deactivation take effect now.
  if (auth) {
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { deactivated_at: true },
    });

    if (!user || user.deactivated_at) {
      auth = null;
    }
  }

  return { prisma, req, res, auth };
}
