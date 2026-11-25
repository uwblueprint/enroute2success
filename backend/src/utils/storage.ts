// Storage provider (AWS S3). This is the only module that imports the AWS SDK, so swapping
// providers means rewriting this file and nothing else. Objects are addressed by storage key
// (their path in the bucket), never by URL.
//
// Configuration (environment):
//   S3_BUCKET   bucket name (required)
//   AWS_REGION  bucket region (required)
//   Credentials come from the AWS default provider chain (AWS_ACCESS_KEY_ID /
//   AWS_SECRET_ACCESS_KEY locally, an IAM role when deployed).
//
// The bucket must stay private (block public access) and its CORS rules must allow `POST`
// from the frontend origin, because the browser sends the upload straight to S3.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export class StorageConfigError extends Error {
  constructor(variable: string) {
    super(`Storage is not configured: ${variable} is not set`);
    this.name = 'StorageConfigError';
  }
}

export type PresignedUpload = {
  url: string;
  fields: Record<string, string>;
  expiresAt: Date;
};

export type StoredObjectInfo = {
  sizeBytes: number;
  contentType: string | null;
};

type StorageConfig = { client: S3Client; bucket: string };

let cached: StorageConfig | undefined;

// Read lazily so the server can start (and unrelated tests run) without S3 configured.
function getConfig(): StorageConfig {
  if (cached) {
    return cached;
  }

  const bucket = process.env.S3_BUCKET?.trim();
  const region = process.env.AWS_REGION?.trim();

  if (!bucket) {
    throw new StorageConfigError('S3_BUCKET');
  }

  if (!region) {
    throw new StorageConfigError('AWS_REGION');
  }

  cached = { client: new S3Client({ region }), bucket };
  return cached;
}

// Presigned POST (not PUT) so S3 itself enforces the size range and content type.
// The client must send `fields` as form fields, then the file as the last field named `file`.
export async function createUploadTarget(params: {
  key: string;
  contentType: string;
  maxBytes: number;
  expiresInSeconds: number;
}): Promise<PresignedUpload> {
  const { client, bucket } = getConfig();

  const { url, fields } = await createPresignedPost(client, {
    Bucket: bucket,
    Key: params.key,
    Fields: { 'Content-Type': params.contentType },
    Conditions: [
      ['content-length-range', 1, params.maxBytes],
      ['eq', '$Content-Type', params.contentType],
    ],
    Expires: params.expiresInSeconds,
  });

  return { url, fields, expiresAt: new Date(Date.now() + params.expiresInSeconds * 1000) };
}

// Returns null when the object does not exist.
export async function getObjectInfo(key: string): Promise<StoredObjectInfo | null> {
  const { client, bucket } = getConfig();

  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { sizeBytes: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }

    throw error;
  }
}

export async function createDownloadUrl(params: {
  key: string;
  downloadName: string;
  expiresInSeconds: number;
}): Promise<string> {
  const { client, bucket } = getConfig();

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: params.key,
      ResponseContentDisposition: contentDisposition(params.downloadName),
    }),
    { expiresIn: params.expiresInSeconds }
  );
}

// S3 treats deleting a missing key as success, so this is safe to retry.
export async function deleteObject(key: string): Promise<void> {
  const { client, bucket } = getConfig();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return name === 'NotFound' || name === 'NoSuchKey' || $metadata?.httpStatusCode === 404;
}

// Always `attachment` so uploaded HTML or SVG is downloaded, never rendered on the bucket origin.
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
