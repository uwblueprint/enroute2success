import { randomUUID } from 'node:crypto';
import { Prisma, Role } from '../../generated/client';
import type { PrismaClient, StaffUsers, Student, User } from '../../generated/client';
import { generateAccessToken } from '../utils/accessTokens';
import {
  generateAccountSetupToken,
  getAccountSetupTokenExpiry,
  getAccountSetupUrl,
  hashAccountSetupToken,
} from '../utils/accountSetupTokens';
import { hashPassword, verifyPassword } from '../utils/passwords';
import {
  generateRefreshToken,
  getRefreshTokenExpiry,
  hashRefreshToken,
} from '../utils/refreshTokens';
import { sendSetPasswordEmail } from './emailService';

// A database user with their staff relation loaded.
// The staff relation can be null.
export type UserWithStaff = User & {
  staff: StaffUsers | null;
};

export type AuthPayload = {
  accessToken: string;
  user: UserWithStaff;
  managedStudents: Student[];
  activeStudent: Student | null;
};

export type AuthSession = AuthPayload & {
  refreshToken: string;
  refreshTokenExpiresAt: Date;
};

export type LoginInput = {
  email?: string | null;
  membershipId?: number | null;
  password: string;
};

export type CreateStaffAccountInput = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  password: string;
  role: Role;
};

export type CompleteAccountSetupInput = {
  token: string;
  newPassword: string;
  firstName?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
};

type AccountSetupField = 'email' | 'newPassword' | 'firstName' | 'lastName' | 'phoneNumber';

export class InvalidAccountSetupInputError extends Error {
  constructor(
    public readonly field: AccountSetupField,
    message: string
  ) {
    super(message);
    this.name = 'InvalidAccountSetupInputError';
  }
}

export class InvalidAccountSetupTokenError extends Error {
  constructor() {
    super('Account setup link is invalid or expired');
    this.name = 'InvalidAccountSetupTokenError';
  }
}

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

export class InvalidLoginInputError extends Error {
  constructor() {
    super('Provide exactly one of email or membershipId');
    this.name = 'InvalidLoginInputError';
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

export async function getManagedStudents(prisma: PrismaClient, userId: string): Promise<Student[]> {
  return prisma.student.findMany({
    where: { manager_id: userId },
    orderBy: { membership_id: 'asc' },
  });
}

type LoginPortal = 'staff' | 'student';

function matchesLoginPortal(user: UserWithStaff, portal: LoginPortal): boolean {
  return portal === 'staff'
    ? user.staff !== null && user.staff.role !== Role.STUDENT
    : user.staff === null;
}

function createAuthPayload(
  user: UserWithStaff,
  students: Student[],
  membershipId?: number
): AuthPayload | null {
  if (user.staff?.role === Role.STUDENT) {
    return null;
  }

  const managedStudents = user.staff ? [] : students;
  let activeStudent: Student | null = null;

  if (membershipId !== undefined) {
    activeStudent =
      managedStudents.find((student) => student.membership_id === membershipId) ?? null;

    if (activeStudent === null) {
      return null;
    }
  } else if (managedStudents.length === 1) {
    activeStudent = managedStudents[0];
  }

  return {
    accessToken: generateAccessToken({
      userId: user.id,
      role: user.staff?.role ?? Role.STUDENT,
      activeStudentId: activeStudent?.membership_id ?? null,
    }),
    user,
    managedStudents,
    activeStudent,
  };
}

function createSession(
  user: UserWithStaff,
  students: Student[],
  membershipId?: number
): AuthSession | null {
  const payload = createAuthPayload(user, students, membershipId);

  if (!payload) {
    return null;
  }

  return {
    ...payload,
    refreshToken: generateRefreshToken(),
    refreshTokenExpiresAt: getRefreshTokenExpiry(),
  };
}

async function loginAccount(
  prisma: PrismaClient,
  user: UserWithStaff | null,
  password: string,
  portal: LoginPortal,
  membershipId?: number
): Promise<AuthSession | null> {
  let passwordMatches = false;

  if (user) {
    passwordMatches = await verifyPassword(user.password_hash, password);
  } else {
    await hashPassword(password);
  }

  if (!user || !passwordMatches || !matchesLoginPortal(user, portal)) {
    return null;
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "users"
        WHERE "id" = ${user.id}::uuid
        FOR UPDATE
      `;

      const currentUser = await tx.user.findUnique({
        where: { id: user.id },
        include: { staff: true, students: { orderBy: { membership_id: 'asc' } } },
      });

      if (
        !currentUser ||
        currentUser.password_hash !== user.password_hash ||
        !matchesLoginPortal(currentUser, portal)
      ) {
        return null;
      }

      const session = createSession(currentUser, currentUser.students, membershipId);

      if (!session) {
        return null;
      }

      await tx.refresh_tokens.create({
        data: {
          id: randomUUID(),
          user_id: user.id,
          token_hash: hashRefreshToken(session.refreshToken),
          expires_at: session.refreshTokenExpiresAt,
        },
      });

      return session;
    },
    { isolationLevel: 'ReadCommitted' }
  );
}

export async function loginStaff(
  prisma: PrismaClient,
  email: string,
  password: string
): Promise<AuthSession | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { staff: true },
  });

  return loginAccount(prisma, user, password, 'staff');
}

export async function loginStudent(
  prisma: PrismaClient,
  input: LoginInput
): Promise<AuthSession | null> {
  const { email, membershipId, password } = input;

  if ((email != null) === (membershipId != null)) {
    throw new InvalidLoginInputError();
  }

  let user: UserWithStaff | null;

  if (email != null) {
    user = await prisma.user.findUnique({
      where: { email },
      include: { staff: true },
    });
  } else {
    const student = await prisma.student.findUnique({
      where: { membership_id: membershipId! },
      include: { manager: { include: { staff: true } } },
    });
    user = student?.manager ?? null;
  }

  return loginAccount(prisma, user, password, 'student', membershipId ?? undefined);
}

export async function selectActiveStudent(
  prisma: PrismaClient,
  userId: string,
  membershipId: number
): Promise<AuthPayload | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { staff: true, students: { orderBy: { membership_id: 'asc' } } },
  });

  if (!user || !matchesLoginPortal(user, 'student')) {
    return null;
  }

  // The students relation contains only profiles managed by this account.
  return createAuthPayload(user, user.students, membershipId);
}

export async function requestAccountSetup(
  prisma: PrismaClient,
  email: string,
  membershipId: number
): Promise<boolean> {
  const setupEmail = email.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(setupEmail)) {
    throw new InvalidAccountSetupInputError('email', 'Provide a valid email address');
  }

  const student = await prisma.student.findUnique({
    where: { membership_id: membershipId },
  });

  if (!student || student.manager_id !== null) {
    return true;
  }

  const user = await prisma.user.findUnique({
    where: { email: setupEmail },
    include: { staff: true },
  });

  if (user && !matchesLoginPortal(user, 'student')) {
    return true;
  }

  const rawToken = generateAccountSetupToken();
  const setupUrl = getAccountSetupUrl(rawToken);

  try {
    await prisma.accountSetupToken.create({
      data: {
        email: setupEmail,
        membership_id: membershipId,
        user_id: user?.id ?? null,
        token_hash: hashAccountSetupToken(rawToken),
        expires_at: getAccountSetupTokenExpiry(),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return true;
    }

    throw error;
  }

  try {
    await sendSetPasswordEmail(setupEmail, setupUrl);
  } catch {
    console.error('[accountSetup] Failed to send setup email');
  }

  return true;
}

function requireAccountSetupField(
  value: string | null | undefined,
  field: AccountSetupField
): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new InvalidAccountSetupInputError(field, `${field} is required for a new account`);
  }

  return trimmed;
}

export async function completeAccountSetup(
  prisma: PrismaClient,
  input: CompleteAccountSetupInput
): Promise<AuthSession> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) {
    throw new InvalidAccountSetupTokenError();
  }

  const tokenHash = hashAccountSetupToken(input.token);
  const pending = await prisma.accountSetupToken.findUnique({
    where: { token_hash: tokenHash },
  });

  if (!pending || pending.used_at !== null || pending.expires_at.getTime() <= Date.now()) {
    throw new InvalidAccountSetupTokenError();
  }

  if (input.newPassword.trim().length === 0) {
    throw new InvalidAccountSetupInputError('newPassword', 'A password is required');
  }

  const passwordHash = await hashPassword(input.newPassword);

  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const setup = await tx.accountSetupToken.findUnique({
            where: { token_hash: tokenHash },
          });

          if (!setup || setup.used_at !== null || setup.expires_at.getTime() <= Date.now()) {
            throw new InvalidAccountSetupTokenError();
          }

          let user = await tx.user.findUnique({
            where: { email: setup.email },
            include: { staff: true },
          });

          if (user) {
            await tx.$queryRaw`
              SELECT "id" FROM "users"
              WHERE "id" = ${user.id}::uuid
              FOR UPDATE
            `;
            user = await tx.user.findUnique({
              where: { id: user.id },
              include: { staff: true },
            });
          }

          if (
            (setup.user_id !== null && setup.user_id !== user?.id) ||
            (user && (user.email !== setup.email || !matchesLoginPortal(user, 'student')))
          ) {
            throw new InvalidAccountSetupTokenError();
          }

          const firstName = user
            ? user.first_name
            : requireAccountSetupField(input.firstName, 'firstName');
          const lastName = user
            ? user.last_name
            : requireAccountSetupField(input.lastName, 'lastName');
          const phoneNumber = user
            ? user.phone_number
            : requireAccountSetupField(input.phoneNumber, 'phoneNumber');

          const consumed = await tx.accountSetupToken.updateMany({
            where: { id: setup.id, used_at: null, expires_at: { gt: new Date() } },
            data: { used_at: new Date() },
          });

          if (consumed.count !== 1) {
            throw new InvalidAccountSetupTokenError();
          }

          user = user
            ? await tx.user.update({
                where: { id: user.id },
                data: { password_hash: passwordHash },
                include: { staff: true },
              })
            : await tx.user.create({
                data: {
                  id: randomUUID(),
                  email: setup.email,
                  first_name: firstName,
                  last_name: lastName,
                  phone_number: phoneNumber,
                  password_hash: passwordHash,
                },
                include: { staff: true },
              });

          const claimed = await tx.student.updateMany({
            where: { membership_id: setup.membership_id, manager_id: null },
            data: { manager_id: user.id },
          });

          if (claimed.count !== 1) {
            throw new InvalidAccountSetupTokenError();
          }

          await tx.refresh_tokens.updateMany({
            where: { user_id: user.id, revoked_at: null },
            data: { revoked_at: new Date() },
          });

          const students = await tx.student.findMany({
            where: { manager_id: user.id },
            orderBy: { membership_id: 'asc' },
          });
          const session = createSession(user, students, setup.membership_id);

          if (!session) {
            throw new InvalidAccountSetupTokenError();
          }

          await tx.refresh_tokens.create({
            data: {
              id: randomUUID(),
              user_id: user.id,
              token_hash: hashRefreshToken(session.refreshToken),
              expires_at: session.refreshTokenExpiresAt,
            },
          });

          return session;
        },
        { isolationLevel: 'ReadCommitted' }
      );
    } catch (error) {
      if (
        attempt < 2 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      ) {
        continue;
      }

      throw error;
    }
  }
}

export async function rotateRefreshToken(
  prisma: PrismaClient,
  rawToken: string
): Promise<AuthSession | null> {
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
        include: {
          user: { include: { staff: true, students: { orderBy: { membership_id: 'asc' } } } },
        },
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

      if (storedToken.expires_at.getTime() <= now.getTime()) {
        return null;
      }

      const session = createSession(storedToken.user, storedToken.user.students);

      if (!session) {
        return null;
      }

      await tx.refresh_tokens.update({
        where: { id: storedToken.id },
        data: { revoked_at: now },
      });
      await tx.refresh_tokens.create({
        data: {
          id: randomUUID(),
          user_id: storedToken.user_id,
          token_hash: hashRefreshToken(session.refreshToken),
          expires_at: session.refreshTokenExpiresAt,
        },
      });

      return session;
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
