import { randomUUID } from 'node:crypto';
import { Prisma, Role } from '../../generated/client';
import type { PrismaClient, StaffUsers, User } from '../../generated/client';
import { generateAccessToken } from '../utils/accessTokens';
import { hashPassword, verifyPassword } from '../utils/passwords';
import {
  generateRefreshToken,
  getRefreshTokenExpiry,
  hashRefreshToken,
} from '../utils/refreshTokens';

// A database user with their staff relation loaded.
// The staff relation can be null.
export type UserWithStaff = User & {
  staff: StaffUsers | null;
};

export type StaffSession = {
  accessToken: string;
  user: UserWithStaff;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
};

export type CreateStaffAccountInput = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  password: string;
  role: Role;
};

export class EmailInUseError extends Error {
  constructor() {
    super('Email is already in use');
    this.name = 'EmailInUseError';
  }
}

export class InvalidStaffRoleError extends Error {
  constructor() {
    super('Staff accounts require an ADMIN, COACH, or VOLUNTEER role');
    this.name = 'InvalidStaffRoleError';
  }
}

export async function getUserWithStaff(
  prisma: PrismaClient,
  userId: string
): Promise<UserWithStaff | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { staff: true },
  });
}

export async function loginStaff(
  prisma: PrismaClient,
  email: string,
  password: string
): Promise<StaffSession | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { staff: true },
  });

  let passwordMatches = false;

  if (user) {
    passwordMatches = await verifyPassword(user.password_hash, password);
  } else {
    await hashPassword(password);
  }

  if (!user || !user.staff || !passwordMatches) {
    return null;
  }

  const accessToken = generateAccessToken({
    userId: user.id,
    role: user.staff.role,
    activeStudentId: null,
  });
  const refreshToken = generateRefreshToken();
  const refreshTokenExpiresAt = getRefreshTokenExpiry();

  const issued = await prisma.$transaction(
    async (tx) => {
      const [currentUser] = await tx.$queryRaw<Array<{ password_hash: string }>>`
        SELECT "password_hash" FROM "users"
        WHERE "id" = ${user.id}::uuid
        FOR UPDATE
      `;

      if (currentUser?.password_hash !== user.password_hash) {
        return false;
      }

      await tx.refresh_tokens.create({
        data: {
          id: randomUUID(),
          user_id: user.id,
          token_hash: hashRefreshToken(refreshToken),
          expires_at: refreshTokenExpiresAt,
        },
      });

      return true;
    },
    { isolationLevel: 'ReadCommitted' }
  );

  if (!issued) {
    return null;
  }

  return { accessToken, user, refreshToken, refreshTokenExpiresAt };
}

export async function rotateRefreshToken(
  prisma: PrismaClient,
  rawToken: string
): Promise<StaffSession | null> {
  const tokenHash = hashRefreshToken(rawToken);

  return prisma.$transaction(
    async (tx) => {
      const tokenOwner = await tx.refresh_tokens.findUnique({
        where: { token_hash: tokenHash },
        select: { user_id: true },
      });

      if (!tokenOwner) {
        return null;
      }

      await tx.$queryRaw`
        SELECT "id" FROM "users"
        WHERE "id" = ${tokenOwner.user_id}::uuid
        FOR UPDATE
      `;

      const storedToken = await tx.refresh_tokens.findUnique({
        where: { token_hash: tokenHash },
        include: { user: { include: { staff: true } } },
      });

      if (!storedToken) {
        return null;
      }

      const now = new Date();

      // Reuse of a revoked token means it may have been stolen, so revoke every
      // active token for the user. Returning (not throwing) keeps this committed.
      if (storedToken.revoked_at !== null) {
        await tx.refresh_tokens.updateMany({
          where: { user_id: storedToken.user_id, revoked_at: null },
          data: { revoked_at: now },
        });

        return null;
      }

      if (storedToken.expires_at.getTime() <= now.getTime() || !storedToken.user.staff) {
        return null;
      }

      const accessToken = generateAccessToken({
        userId: storedToken.user.id,
        role: storedToken.user.staff.role,
        activeStudentId: null,
      });
      const refreshToken = generateRefreshToken();
      const refreshTokenExpiresAt = getRefreshTokenExpiry();

      await tx.refresh_tokens.update({
        where: { id: storedToken.id },
        data: { revoked_at: now },
      });
      await tx.refresh_tokens.create({
        data: {
          id: randomUUID(),
          user_id: storedToken.user_id,
          token_hash: hashRefreshToken(refreshToken),
          expires_at: refreshTokenExpiresAt,
        },
      });

      return { accessToken, user: storedToken.user, refreshToken, refreshTokenExpiresAt };
    },
    { isolationLevel: 'ReadCommitted' }
  );
}

export async function revokeRefreshToken(prisma: PrismaClient, rawToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(rawToken);

  await prisma.$transaction(
    async (tx) => {
      const tokenOwner = await tx.refresh_tokens.findUnique({
        where: { token_hash: tokenHash },
        select: { user_id: true },
      });

      if (!tokenOwner) {
        return;
      }

      await tx.$queryRaw`
        SELECT "id" FROM "users"
        WHERE "id" = ${tokenOwner.user_id}::uuid
        FOR UPDATE
      `;

      await tx.refresh_tokens.updateMany({
        where: { token_hash: tokenHash, revoked_at: null },
        data: { revoked_at: new Date() },
      });
    },
    { isolationLevel: 'ReadCommitted' }
  );
}

export async function createStaffAccount(
  prisma: PrismaClient,
  input: CreateStaffAccountInput
): Promise<UserWithStaff> {
  if (input.role === Role.STUDENT) {
    throw new InvalidStaffRoleError();
  }

  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.user.create({
      data: {
        id: randomUUID(),
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        phone_number: input.phoneNumber,
        password_hash: passwordHash,
        staff: { create: { role: input.role } },
      },
      include: { staff: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existingUser = await prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });

      if (existingUser) {
        throw new EmailInUseError();
      }
    }

    throw error;
  }
}

// Returns false if the user doesn't exist.
export async function setUserPassword(
  prisma: PrismaClient,
  userId: string,
  newPassword: string
): Promise<boolean> {
  const passwordHash = await hashPassword(newPassword);

  return prisma.$transaction(
    async (tx) => {
      const updatedUser = await tx.user.updateMany({
        where: { id: userId },
        data: { password_hash: passwordHash },
      });

      if (updatedUser.count === 0) {
        return false;
      }

      await tx.refresh_tokens.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: new Date() },
      });

      return true;
    },
    { isolationLevel: 'ReadCommitted' }
  );
}
