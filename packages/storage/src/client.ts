import type { Readable } from "node:stream";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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

export interface StorageClient {
  head(key: string): Promise<ObjectMetadata | null>;
  get(key: string): Promise<GetObjectResult>;
  put(
    key: string,
    body: Buffer | Uint8Array | Readable,
    opts?: { contentType?: string },
  ): Promise<void>;
  presignPut(
    key: string,
    opts: { contentType: string; expiresInSeconds?: number },
  ): Promise<string>;
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
  };
}
