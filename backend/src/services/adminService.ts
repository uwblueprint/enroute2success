import { randomUUID } from 'node:crypto';
import { Prisma, Role } from '../../generated/client';
import type { PrismaClient } from '../../generated/client';
import { hashPassword } from '../utils/passwords';
import { EmailInUseError } from './userService';
import type { UserWithStaff } from './userService';

export type CreateUserInput = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  password: string;
  role: Role;
};

export type ListUsersFilter = {
  role: Role | null;
  includeDeactivated: boolean;
};

export class UserNotFoundError extends Error {
  constructor() {
    super('User not found');
    this.name = 'UserNotFoundError';
  }
}

export class CannotDeactivateSelfError extends Error {
  constructor() {
    super('You cannot deactivate your own account');
    this.name = 'CannotDeactivateSelfError';
  }
}

export class LastAdminError extends Error {
  constructor() {
    super('At least one admin account must stay active');
    this.name = 'LastAdminError';
  }
}

export async function listUsers(
  prisma: PrismaClient,
  filter: ListUsersFilter
): Promise<UserWithStaff[]> {
  const where: Prisma.UserWhereInput = filter.includeDeactivated ? {} : { deactivated_at: null };

  if (filter.role === Role.STUDENT) {
    where.staff = null;
  } else if (filter.role) {
    where.staff = { role: filter.role };
  }

  return prisma.user.findMany({
    where,
    include: { staff: true },
    orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }],
  });
}

export async function createUser(
  prisma: PrismaClient,
  input: CreateUserInput
): Promise<UserWithStaff> {
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
        staff: input.role === Role.STUDENT ? undefined : { create: { role: input.role } },
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

export async function deactivateUser(
  prisma: PrismaClient,
  callerId: string,
  userId: string
): Promise<UserWithStaff> {
  // UUID inputs keep their case, but Postgres matches them case-insensitively, so compare in
  // lowercase or an uppercased ID would slip past the self and last-admin checks.
  userId = userId.toLowerCase();

  if (userId === callerId.toLowerCase()) {
    throw new CannotDeactivateSelfError();
  }

  return prisma.$transaction(
    async (tx) => {
      // Staff roles never change, so this can be read before taking any locks.
      const target = await tx.staffUsers.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      // Lock every active admin first, in a fixed order, so two admins deactivating each other at
      // the same time can't both succeed and leave no admins. Skipped for non-admins so other
      // admins' logins don't wait on it.
      const activeAdmins =
        target?.role === Role.ADMIN
          ? await tx.$queryRaw<{ id: string }[]>`
              SELECT u."id" FROM "users" u
              JOIN "staff_users" s ON s."id" = u."id"
              WHERE s."type" = 'admin' AND u."deactivated_at" IS NULL
              ORDER BY u."id"
              FOR UPDATE OF u
            `
          : [];

      // Same lock that login and token refresh take, so they can't hand out a new session while
      // this runs.
      await tx.$queryRaw`
        SELECT "id" FROM "users"
        WHERE "id" = ${userId}::uuid
        FOR UPDATE
      `;

      const user = await tx.user.findUnique({ where: { id: userId }, include: { staff: true } });

      if (!user) {
        throw new UserNotFoundError();
      }

      if (user.deactivated_at) {
        return user;
      }

      if (user.staff?.role === Role.ADMIN && !activeAdmins.some((admin) => admin.id !== userId)) {
        throw new LastAdminError();
      }

      const now = new Date();

      await tx.refresh_tokens.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: now },
      });

      return tx.user.update({
        where: { id: userId },
        data: { deactivated_at: now },
        include: { staff: true },
      });
    },
    { isolationLevel: 'ReadCommitted' }
  );
}

export async function reactivateUser(prisma: PrismaClient, userId: string): Promise<UserWithStaff> {
  try {
    return await prisma.user.update({
      where: { id: userId },
      data: { deactivated_at: null },
      include: { staff: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new UserNotFoundError();
    }

    throw error;
  }
}
