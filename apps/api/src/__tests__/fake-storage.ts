import type { PresignedPost, StorageClient } from "@photon/storage";

export interface FakePresignPostCall {
  key: string;
  contentType: string;
  maxBytes: number;
  expiresInSeconds?: number;
}

export interface FakeStorage extends StorageClient {
  presignPostCalls: FakePresignPostCall[];
  clear(): void;
}

export function createFakeStorage(): FakeStorage {
  const presignPostCalls: FakePresignPostCall[] = [];

  return {
    presignPostCalls,
    clear() {
      presignPostCalls.length = 0;
    },
    async head() {
      throw new Error("not implemented in fake storage");
    },
    async get() {
      throw new Error("not implemented in fake storage");
    },
    async put() {
      throw new Error("not implemented in fake storage");
    },
    async delete() {
      throw new Error("not implemented in fake storage");
    },
    async presignPut(): Promise<string> {
      throw new Error("not implemented in fake storage");
    },
    async presignPost(key, opts): Promise<PresignedPost> {
      presignPostCalls.push({ key, ...opts });
      return {
        url: "https://fake-upload.example/",
        fields: { key, "Content-Type": opts.contentType },
      };
    },
  };
}

export const fakeStorage = createFakeStorage();
