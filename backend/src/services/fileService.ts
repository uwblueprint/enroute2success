// File records and permissions. Provider (S3) calls are delegated to ../utils/storage.

import { randomUUID } from 'node:crypto';
import { Prisma, Role } from '../../generated/client';
import type { File, PrismaClient } from '../../generated/client';
import { staffRoles, type AuthenticatedUser } from '../utils/auth';
import {
  createDownloadUrl,
  createUploadTarget,
  deleteObject,
  getObjectInfo,
} from '../utils/storage';

export const FILE_NAME_MAX_LENGTH = 255;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const UPLOAD_URL_TTL_SECONDS = 5 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Works with the normal client or a transaction client, so feature tickets can call
// these helpers inside their own transaction.
type Db = PrismaClient | Prisma.TransactionClient;

export class FileNotFoundError extends Error {
  constructor() {
    super('File not found');
    this.name = 'FileNotFoundError';
  }
}

export class FileValidationError extends Error {
  constructor(
    message: string,
    readonly field: string
  ) {
    super(message);
    this.name = 'FileValidationError';
  }
}

// The upload is missing or failed verification. The file stays (or is returned to) non-`ready`.
export class FileUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileUploadError';
  }
}

export class FileNotReadyError extends Error {
  constructor() {
    super('File upload has not been confirmed');
    this.name = 'FileNotReadyError';
  }
}

export class FileInUseError extends Error {
  constructor() {
    super('This file is attached to other records and cannot be deleted or reused');
    this.name = 'FileInUseError';
  }
}

export type PendingFileUpload = {
  file: File;
  uploadUrl: string;
  uploadFields: Record<string, string>;
  expiresAt: Date;
};

// Step 1 of the upload flow. Callers validate the input against the limits first (see
// fileResolvers). Creates a `pending` record owned by the uploader and returns a
// presigned POST target. S3 itself rejects bodies that are empty, larger than `sizeBytes`, or
// sent with a different Content-Type.
export async function createPendingFile(
  prisma: Db,
  uploaderId: string,
  input: { originalName: string; mimeType: string; sizeBytes: number }
): Promise<PendingFileUpload> {
  const originalName = normalizeOriginalName(input.originalName);
  const mimeType = input.mimeType.trim().toLowerCase();
  const { sizeBytes } = input;

  // The key is random and never contains the user's filename.
  const id = randomUUID();
  const storageKey = `files/${id}`;

  const target = await createUploadTarget({
    key: storageKey,
    contentType: mimeType,
    maxBytes: sizeBytes,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  });

  const file = await prisma.file.create({
    data: {
      id,
      original_name: originalName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      storage_key: storageKey,
      uploader_id: uploaderId,
    },
  });

  return { file, uploadUrl: target.url, uploadFields: target.fields, expiresAt: target.expiresAt };
}

// Step 3. Only the uploader can confirm. The record becomes `ready` only if the object exists
// and its real size and type (as stored by S3, not as claimed by the client) pass the limits.
export async function confirmUpload(
  prisma: PrismaClient,
  uploaderId: string,
  fileId: string
): Promise<File> {
  const file = await findOwnedFile(prisma, uploaderId, fileId);

  if (file.status === 'ready') {
    return file;
  }

  const object = await getObjectInfo(file.storage_key);

  if (!object) {
    // Keep the record so the client can finish uploading and confirm again.
    throw new FileUploadError('The file has not been uploaded');
  }

  const failure = verifyObject(file, object);

  if (failure) {
    // Remove what was uploaded so an invalid object cannot linger or be confirmed later.
    await removeFile(prisma, file);
    throw new FileUploadError(failure);
  }

  return prisma.file.update({
    where: { id: file.id },
    data: { status: 'ready', size_bytes: object.sizeBytes },
  });
}

// Returns a fresh signed download URL, or null while the file is not `ready`. This does not
// check permissions: call `requireFileAccess` first.
export async function generateURL(prisma: Db, fileId: string): Promise<string | null> {
  const file = await prisma.file.findUnique({ where: { id: assertUuid(fileId) } });

  if (!file) {
    throw new FileNotFoundError();
  }

  if (file.status !== 'ready') {
    return null;
  }

  return createDownloadUrl({
    key: file.storage_key,
    downloadName: file.original_name,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
  });
}

// Deletes the storage object and the database record. Allowed for the uploader and admins.
// Anyone else gets "not found", and attached files are refused with `FileInUseError`.
export async function deleteFile(
  prisma: PrismaClient,
  caller: AuthenticatedUser,
  fileId: string
): Promise<File> {
  const file = await prisma.file.findUnique({ where: { id: assertUuid(fileId) } });

  if (!file || (file.uploader_id !== caller.userId && caller.role !== Role.ADMIN)) {
    throw new FileNotFoundError();
  }

  return removeFile(prisma, file);
}

// Use before attaching a file to a feature: the file must exist, be `ready`, belong to the
// requesting user, and not be attached already. Returns the file.
export async function validateFile(prisma: Db, uploaderId: string, fileId: string): Promise<File> {
  const file = await findOwnedFile(prisma, uploaderId, fileId);

  if (file.status !== 'ready') {
    throw new FileNotReadyError();
  }

  if (await isFileAttached(prisma, file.id)) {
    throw new FileInUseError();
  }

  return file;
}

// A file is attached once it has recipients. When a feature table gains a file FK
// (e.g. feedback.file_id), add its check here so `validateFile` and `deleteFile` see it too.
export async function isFileAttached(prisma: Db, fileId: string): Promise<boolean> {
  const recipients = await prisma.fileRecipient.count({ where: { file_id: fileId } });
  return recipients > 0;
}

// Throws `FileNotFoundError` unless the caller is staff, the uploader, or manages a student who
// is a recipient of the file. Reads the database on every call (not the JWT's activeStudentId),
// so a guardian can open any managed student's file. "Forbidden" and "missing" are the same
// error, so file IDs cannot be probed.
export async function requireFileAccess(
  prisma: Db,
  caller: AuthenticatedUser,
  fileId: string
): Promise<File> {
  const id = assertUuid(fileId);
  const isStaff = (staffRoles as readonly Role[]).includes(caller.role);

  const file = await prisma.file.findFirst({
    where: isStaff
      ? { id }
      : {
          id,
          OR: [
            { uploader_id: caller.userId },
            { recipients: { some: { student: { manager_id: caller.userId } } } },
          ],
        },
  });

  if (!file) {
    throw new FileNotFoundError();
  }

  return file;
}

// The one call feature tickets make when attaching a file. Safe to repeat for the same student.
export async function grantFileRecipients(
  prisma: Db,
  fileId: string,
  studentIds: readonly number[]
): Promise<void> {
  const ids = [...new Set(studentIds)];

  if (ids.length === 0) {
    return;
  }

  try {
    await prisma.fileRecipient.createMany({
      data: ids.map((student_id) => ({ file_id: assertUuid(fileId), student_id })),
      skipDuplicates: true,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throw new FileValidationError('File or student does not exist', 'studentIds');
    }

    throw error;
  }
}

async function findOwnedFile(prisma: Db, uploaderId: string, fileId: string): Promise<File> {
  const file = await prisma.file.findFirst({
    where: { id: assertUuid(fileId), uploader_id: uploaderId },
  });

  if (!file) {
    throw new FileNotFoundError();
  }

  return file;
}

// Database record first: if a feature still references the file the delete fails and the
// object is kept. A storage failure afterwards leaves an unreferenced object, never a
// record that points at nothing.
async function removeFile(prisma: PrismaClient, file: File): Promise<File> {
  try {
    const { count } = await prisma.file.deleteMany({
      where: { id: file.id, recipients: { none: {} } },
    });

    if (count === 0) {
      throw new FileInUseError();
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throw new FileInUseError();
    }

    throw error;
  }

  await deleteObject(file.storage_key);
  return file;
}

function verifyObject(
  file: File,
  object: { sizeBytes: number; contentType: string | null }
): string | null {
  if (object.sizeBytes <= 0) {
    return 'The uploaded file is empty';
  }

  if (object.sizeBytes > MAX_FILE_BYTES) {
    return `Files can be at most ${MAX_FILE_BYTES / (1024 * 1024)} MB`;
  }

  if (object.sizeBytes > file.size_bytes) {
    return 'The uploaded file is larger than declared';
  }

  if (object.contentType?.toLowerCase() !== file.mime_type) {
    return 'The uploaded file type does not match the requested type';
  }

  return null;
}

function normalizeOriginalName(value: string): string {
  // Keep only the last path segment and drop control characters.
  const name = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .split(/[\\/]/)
    .pop()!
    .trim();

  if (name.length === 0) {
    throw new FileValidationError('originalName cannot be empty', 'originalName');
  }

  return name;
}

// A malformed ID can never match a row, so report it the same way as a missing file.
function assertUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new FileNotFoundError();
  }

  return value;
}
