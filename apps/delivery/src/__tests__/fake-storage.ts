import { Readable } from "node:stream";
import type { StorageClient } from "@photon/storage";
import { ObjectNotFoundError } from "@photon/storage";

interface StoredObject {
  body: Buffer;
  contentType: string | undefined;
}

export interface FakeStorage extends StorageClient {
  seed(key: string, body: Buffer, contentType?: string): void;
  clear(): void;
  has(key: string): boolean;
}

async function toBuffer(body: Buffer | Uint8Array | Readable): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function createFakeStorage(): FakeStorage {
  const store = new Map<string, StoredObject>();

  return {
    seed(key, body, contentType) {
      store.set(key, { body, contentType });
    },
    clear() {
      store.clear();
    },
    has(key) {
      return store.has(key);
    },
    async head(key) {
      const entry = store.get(key);
      if (!entry) return null;
      return { contentType: entry.contentType, contentLength: entry.body.length, etag: undefined };
    },
    async get(key) {
      const entry = store.get(key);
      if (!entry) throw new ObjectNotFoundError(key);
      return {
        stream: Readable.from(entry.body),
        contentType: entry.contentType,
        contentLength: entry.body.length,
        etag: undefined,
      };
    },
    async put(key, body, opts) {
      const buf = await toBuffer(body);
      store.set(key, { body: buf, contentType: opts?.contentType });
    },
    async delete(key) {
      store.delete(key);
    },
    async presignPut(): Promise<string> {
      throw new Error("not implemented in fake storage");
    },
    async presignPost(): Promise<{ url: string; fields: Record<string, string> }> {
      throw new Error("not implemented in fake storage");
    },
  };
}

export const fakeStorage = createFakeStorage();
