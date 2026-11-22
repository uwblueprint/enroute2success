//handles provider calls and database logic

import { Prisma } from '../../generated/client';
import type { File, FileRecipient, PrismaClient } from '../../generated/client';
import { currentLocalDate, localDayEndUtc, localDayStartUtc } from '../utils/datetime';

//Create a pending file record and generate a presigned upload URL
//Confirm an upload: check the object exists in storage, check its size and type against the limits, then mark the file `ready`
//Generate a signed download URL for a file given its ID
//Delete a file (storage object AND database record)
//Validate that a file can be attached to a feature: it exists, is `ready`, belongs to the requesting user, and is not already attached elsewhere (exposed as a helper so feature tickets can reuse it)
//`requireFileAccess(prisma, caller, fileId)`: throws unless the caller is staff, or the caller manages a `Student` that's a `FileRecipient` on the file. Query this fresh against the DB — don't rely on the JWT's `activeStudentId`, since a parent/guardian can manage more than one student and shouldn't be blocked from one kid's file just because a different kid is "active." Treat "forbidden" and "not found" identically (both → `NOT_FOUND`) so file IDs can't be probed by comparing error codes.
//`grantFileRecipients(prisma, fileId, studentIds)`: inserts the `FileRecipient` rows for a file. This is the one call feature tickets (feedback, homework) need to make when they attach a file — they shouldn't need to touch `FileRecipient` or permission logic directly.
//Keep the provider calls in one module (e.g. `backend/src/utils/storage.ts`) so the provider can be swapped later without touching the resolvers.
   