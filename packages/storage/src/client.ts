import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ObjectNotFoundError } from "./errors";

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export interface ObjectMetadata {
  contentType?: string | undefined;
  contentLength?: number | undefined;
  etag?: string | undefined;
}

export interface GetObjectResult extends ObjectMetadata {
  stream: Readable;
}

export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
}

export interface StorageClient {
  head(key: string): Promise<ObjectMetadata | null>;
  get(key: string): Promise<GetObjectResult>;
  put(
    key: string,
    body: Buffer | Uint8Array | Readable,
    opts?: { contentType?: string },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  presignPut(
    key: string,
    opts: { contentType: string; expiresInSeconds?: number },
  ): Promise<string>;
  // Presigned POST (vs. presignPut's presigned PUT) lets us enforce a hard
  // max upload size via an S3 POST-policy condition. MinIO also implements
  // S3 POST policies, so this works unmodified against the local
  // docker-compose MinIO service.
  presignPost(
    key: string,
    opts: { contentType: string; maxBytes: number; expiresInSeconds?: number },
  ): Promise<PresignedPost>;
}

function isAwsErrorNamed(err: unknown, name: string): boolean {
  return err instanceof Error && err.name === name;
}

export function createStorageClient(config: StorageConfig): StorageClient {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    ...(config.forcePathStyle !== undefined ? { forcePathStyle: config.forcePathStyle } : {}),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    async head(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return {
          contentType: res.ContentType,
          contentLength: res.ContentLength,
          etag: res.ETag,
        };
      } catch (err) {
        if (isAwsErrorNamed(err, "NotFound")) return null;
        throw err;
      }
    },

    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        return {
          stream: res.Body as Readable,
          contentType: res.ContentType,
          contentLength: res.ContentLength,
          etag: res.ETag,
        };
      } catch (err) {
        if (isAwsErrorNamed(err, "NoSuchKey")) throw new ObjectNotFoundError(key);
        throw err;
      }
    },

    async put(key, body, opts) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: opts?.contentType,
        }),
      );
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },

    async presignPut(key, opts) {
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: opts.contentType,
      });
      return getSignedUrl(client, command, {
        expiresIn: opts.expiresInSeconds ?? 900,
      });
    },

    async presignPost(key, opts) {
      const { url, fields } = await createPresignedPost(client, {
        Bucket: config.bucket,
        Key: key,
        Conditions: [
          ["content-length-range", 0, opts.maxBytes],
          ["eq", "$Content-Type", opts.contentType],
        ],
        Fields: {
          "Content-Type": opts.contentType,
        },
        Expires: opts.expiresInSeconds ?? 900,
      });
      return { url, fields };
    },
  };
}
