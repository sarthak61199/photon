import type { StorageClient, StorageConfig } from "@photon/storage";
import { createStorageClient } from "@photon/storage";

function getStorageConfig(): StorageConfig {
  return {
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    region: process.env.S3_REGION ?? "auto",
    bucket: process.env.S3_BUCKET ?? "img-assets",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  };
}

let client: StorageClient | undefined;

export function getStorageClient(): StorageClient {
  client ??= createStorageClient(getStorageConfig());
  return client;
}
