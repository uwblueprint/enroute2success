import { GraphQLError } from 'graphql';
import type { File } from '../../../generated/client';
import type { GraphQLContext } from '../context';
import {
  ALLOWED_MIME_TYPES,
  confirmUpload,
  createPendingFile,
  deleteFile,
  FILE_NAME_MAX_LENGTH,
  FileInUseError,
  FileNotFoundError,
  FileNotReadyError,
  FileUploadError,
  FileValidationError,
  generateURL,
  MAX_FILE_BYTES,
  requireFileAccess,
} from '../../services/fileService';
import { allRoles, requireRole } from '../../utils/auth';
import { StorageConfigError } from '../../utils/storage';
import { badUserInput, validatePositiveInt, validateText } from '../../utils/validation';

type FileIdArgs = {
  id: string;
};

type FileUploadArgs = {
  fileId: string;
};

type RequestFileUploadArgs = {
  input: {
    originalName: string;
    mimeType: string;
    sizeBytes: number;
  };
};

type FileUploadTarget = {
  fileId: string;
  uploadUrl: string;
  uploadFields: { name: string; value: string }[];
  expiresAt: string;
};

function validateFileInput(input: RequestFileUploadArgs['input']) {
  const originalName = validateText(input.originalName, 'originalName', FILE_NAME_MAX_LENGTH);
  const mimeType = input.mimeType.trim().toLowerCase();
  const sizeBytes = validatePositiveInt(input.sizeBytes, 'sizeBytes');

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw badUserInput('This file type is not allowed', 'mimeType');
  }

  if (sizeBytes > MAX_FILE_BYTES) {
    throw badUserInput(`Files can be at most ${MAX_FILE_BYTES / (1024 * 1024)} MB`, 'sizeBytes');
  }

  return { originalName, mimeType, sizeBytes };
}

// "Forbidden" and "missing" both become NOT_FOUND (see requireFileAccess), so file IDs
// cannot be probed through error codes.
function toGraphQLError(error: unknown, id?: string): unknown {
  if (error instanceof FileNotFoundError) {
    return new GraphQLError(error.message, { extensions: { code: 'NOT_FOUND', id } });
  }

  if (error instanceof FileValidationError) {
    return badUserInput(error.message, error.field);
  }

  if (error instanceof FileUploadError || error instanceof FileNotReadyError) {
    return new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }

  if (error instanceof FileInUseError) {
    return new GraphQLError(error.message, { extensions: { code: 'CONFLICT' } });
  }

  if (error instanceof StorageConfigError) {
    console.error('[files]', error.message);
    return new GraphQLError('File storage is unavailable', {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }

  return error;
}

export const fileResolvers = {
  Query: {
    // Staff and the uploader can always read. A student/parent can read when they manage a
    // student who is a FileRecipient. Feature tickets only call grantFileRecipients.
    file: async (_parent: unknown, args: FileIdArgs, ctx: GraphQLContext): Promise<File> => {
      const caller = requireRole(ctx.auth, allRoles);

      try {
        return await requireFileAccess(ctx.prisma, caller, args.id);
      } catch (error) {
        throw toGraphQLError(error, args.id);
      }
    },
  },

  Mutation: {
    // Any signed-in user. The uploader is always the caller.
    requestFileUpload: async (
      _parent: unknown,
      args: RequestFileUploadArgs,
      ctx: GraphQLContext
    ): Promise<FileUploadTarget> => {
      const caller = requireRole(ctx.auth, allRoles);
      const input = validateFileInput(args.input);

      try {
        const upload = await createPendingFile(ctx.prisma, caller.userId, input);

        return {
          fileId: upload.file.id,
          uploadUrl: upload.uploadUrl,
          uploadFields: Object.entries(upload.uploadFields).map(([name, value]) => ({
            name,
            value,
          })),
          expiresAt: upload.expiresAt.toISOString(),
        };
      } catch (error) {
        throw toGraphQLError(error);
      }
    },

    // Only the uploader. Throws unless the object exists in storage and meets the limits; the
    // file never becomes `ready` otherwise.
    confirmFileUpload: async (
      _parent: unknown,
      args: FileUploadArgs,
      ctx: GraphQLContext
    ): Promise<File> => {
      const caller = requireRole(ctx.auth, allRoles);

      try {
        return await confirmUpload(ctx.prisma, caller.userId, args.fileId);
      } catch (error) {
        throw toGraphQLError(error, args.fileId);
      }
    },

    // Only the uploader or an admin. Files that a feature still references cannot be deleted.
    deleteFile: async (
      _parent: unknown,
      args: FileUploadArgs,
      ctx: GraphQLContext
    ): Promise<File> => {
      const caller = requireRole(ctx.auth, allRoles);

      try {
        return await deleteFile(ctx.prisma, caller, args.fileId);
      } catch (error) {
        if (error instanceof FileInUseError) {
          throw new GraphQLError(
            'This file is attached to other records. Remove it from them before deleting it',
            { extensions: { code: 'CONFLICT', id: args.fileId } }
          );
        }

        throw toGraphQLError(error, args.fileId);
      }
    },
  },

  File: {
    originalName: (file: File) => file.original_name,
    mimeType: (file: File) => file.mime_type,
    sizeBytes: (file: File) => file.size_bytes,
    status: (file: File) => file.status.toUpperCase(),
    createdAt: (file: File) => file.created_at.toISOString(),

    // Only `ready` files get a URL. Checks access itself, so it stays safe when a feature
    // type returns a File.
    downloadUrl: async (
      file: File,
      _args: unknown,
      ctx: GraphQLContext
    ): Promise<string | null> => {
      if (file.status !== 'ready') {
        return null;
      }

      const caller = requireRole(ctx.auth, allRoles);

      try {
        await requireFileAccess(ctx.prisma, caller, file.id);
        return await generateURL(ctx.prisma, file.id);
      } catch (error) {
        throw toGraphQLError(error, file.id);
      }
    },
  },
};
